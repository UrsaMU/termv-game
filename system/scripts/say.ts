/// <reference types="./global.d.ts" />
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import { gameHooks } from "@ursamu/ursamu";

/**
 * sgp-language: say.ts
 *
 * Overrides the engine's stock `say`. When the speaker has an active
 * language (state.languages.active), the message is garbled per-listener
 * based on each listener's skill in that language. Speaker always sees
 * their own message clearly.
 */

export const aliases = ["say", "\""];

// ─── sgp-language inlined garble engine (do not edit; baked from src/) ───

// ── schema.ts ──

interface LangDef {
  schema: 1;
  name: string;
  mode: "phoneme" | "markov";
  onsets?: string[];
  nuclei?: string[];
  codas?: string[];
  syllablePatterns?: string[];
  wordLenWeights?: number[];
  markovCorpus?: string[];
  markovOrder?: number;
  capitalize?: "first" | "all" | "none";
  accentSubs?: Record<string, string>;
  description?: string;
}

interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const PATTERN_RE = /^[CV]+$/;

function validateLangDef(
  raw: unknown,
  fileLabel: string,
): ValidationResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: [`${fileLabel}: not an object`] };
  }
  const r = raw as Record<string, unknown>;

  if (r.schema !== 1) {
    errors.push(`${fileLabel}: schema must be 1`);
  }
  if (typeof r.name !== "string" || !r.name.trim()) {
    errors.push(`${fileLabel}: name required`);
  }
  if (r.mode !== "phoneme" && r.mode !== "markov") {
    errors.push(`${fileLabel}: mode must be "phoneme" or "markov"`);
  }

  if (r.mode === "markov") {
    if (
      !Array.isArray(r.markovCorpus) ||
      r.markovCorpus.some((x) => typeof x !== "string")
    ) {
      errors.push(`${fileLabel}: markovCorpus must be string[]`);
    } else if (r.markovCorpus.length === 0) {
      errors.push(`${fileLabel}: markovCorpus must be non-empty`);
    }
    if (
      r.markovOrder !== undefined &&
      (typeof r.markovOrder !== "number" || r.markovOrder < 1)
    ) {
      errors.push(`${fileLabel}: markovOrder must be a positive number`);
    }
  } else if (r.mode === "phoneme") {
    for (const k of [
      "onsets",
      "nuclei",
      "codas",
      "syllablePatterns",
    ] as const) {
      if (
        !Array.isArray(r[k]) ||
        (r[k] as unknown[]).some((x) => typeof x !== "string")
      ) {
        errors.push(`${fileLabel}: ${k} must be string[]`);
      }
    }
    if (Array.isArray(r.nuclei) && (r.nuclei as string[]).length === 0) {
      errors.push(`${fileLabel}: nuclei must be non-empty`);
    }
    if (Array.isArray(r.syllablePatterns)) {
      for (const p of r.syllablePatterns as string[]) {
        if (typeof p !== "string" || !PATTERN_RE.test(p)) {
          errors.push(
            `${fileLabel}: invalid syllable pattern "${p}" (C/V only)`,
          );
        }
      }
    }
    if (
      !Array.isArray(r.wordLenWeights) ||
      (r.wordLenWeights as unknown[]).some(
        (x) => typeof x !== "number" || (x as number) < 0,
      )
    ) {
      errors.push(
        `${fileLabel}: wordLenWeights must be non-negative number[]`,
      );
    } else if (
      (r.wordLenWeights as number[]).reduce((a, b) => a + b, 0) <= 0
    ) {
      errors.push(`${fileLabel}: wordLenWeights sum must be > 0`);
    }
  }

  if (
    r.capitalize !== undefined &&
    !["first", "all", "none"].includes(r.capitalize as string)
  ) {
    errors.push(`${fileLabel}: capitalize must be first|all|none`);
  }

  return { ok: errors.length === 0, errors };
}

// ── rng.ts ──

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(word: string, langName: string, skillBucket: number): number {
  return fnv1a(`${word.toLowerCase()}|${langName}|${skillBucket}`);
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick(weights: readonly number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ── markov.ts ──

function genWordMarkov(
  corpus: readonly string[],
  order: number,
  rng: () => number,
  approxLen?: number,
): string {
  if (!corpus || corpus.length === 0) return "garble";
  const actualOrder = Math.max(1, Math.min(5, Math.floor(order)));
  const transitions: Record<string, string[]> = {};
  const startState = "^".repeat(actualOrder);

  for (const word of corpus) {
    const w = startState + word.toLowerCase() + "$";
    for (let i = 0; i < w.length - actualOrder; i++) {
      const state = w.slice(i, i + actualOrder);
      const nextChar = w[i + actualOrder];
      if (!transitions[state]) {
        transitions[state] = [];
      }
      transitions[state].push(nextChar);
    }
  }

  const generateOne = (): string => {
    let state = startState;
    let word = "";
    while (word.length < 20) {
      const nexts = transitions[state];
      if (!nexts || nexts.length === 0) break;
      const nextChar = pick(nexts, rng);
      if (nextChar === "$") break;
      word += nextChar;
      state = (state + nextChar).slice(-actualOrder);
    }
    return word;
  };

  if (approxLen !== undefined) {
    let bestWord = "";
    let bestDiff = Infinity;
    for (let i = 0; i < 10; i++) {
      const candidate = generateOne();
      const diff = Math.abs(candidate.length - approxLen);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestWord = candidate;
      }
      if (bestDiff === 0) break;
    }
    return bestWord || "garble";
  }

  return generateOne() || "garble";
}

// ── phonemes.ts ──

function genSyllable(
  def: LangDef,
  rng: () => number,
  isLast: boolean,
): string {
  const pat = pick(def.syllablePatterns!, rng);
  let out = "";
  let sawVowel = false;
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "V") {
      out += pick(def.nuclei!, rng);
      sawVowel = true;
    } else {
      const useCoda =
        sawVowel &&
        i === pat.length - 1 &&
        isLast &&
        (def.codas?.length ?? 0) > 0;
      out += pick(useCoda ? def.codas! : def.onsets!, rng);
    }
  }
  return out;
}

function genWord(
  def: LangDef,
  rng: () => number,
  approxLen?: number,
): string {
  const syllables =
    approxLen ?? (weightedPick(def.wordLenWeights!, rng) + 1);
  let w = "";
  for (let i = 0; i < syllables; i++) {
    w += genSyllable(def, rng, i === syllables - 1);
  }
  return w;
}

function syllableCountFor(wordLen: number): number {
  if (wordLen <= 2) return 1;
  if (wordLen <= 5) return 2;
  if (wordLen <= 8) return 3;
  return Math.min(5, Math.ceil(wordLen / 3));
}

function applyCapitalization(
  word: string,
  original: string,
  mode: LangDef["capitalize"],
): string {
  if (mode === "all") return word.toUpperCase();
  if (mode === "none") return word.toLowerCase();
  if (
    original.length > 0 &&
    original[0] === original[0].toUpperCase() &&
    /[a-z]/i.test(original[0])
  ) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.toLowerCase();
}

// ── garble.ts ──

interface SkillTier {
  bucket: number;
  passThrough: number;
  preserveLength: boolean;
  accent: boolean;
}

function tierFor(skill: number): SkillTier {
  const s = Math.max(0, Math.min(100, Math.floor(skill)));
  if (s >= 91) {
    return {
      bucket: 4,
      passThrough: 1.0,
      preserveLength: true,
      accent: false,
    };
  }
  if (s >= 61) {
    return {
      bucket: 3,
      passThrough: 0.70,
      preserveLength: true,
      accent: true,
    };
  }
  if (s >= 26) {
    return {
      bucket: 2,
      passThrough: 0.30,
      preserveLength: true,
      accent: true,
    };
  }
  if (s >= 1) {
    return {
      bucket: 1,
      passThrough: 0.0,
      preserveLength: true,
      accent: false,
    };
  }
  return {
    bucket: 0,
    passThrough: 0.0,
    preserveLength: false,
    accent: false,
  };
}

const WORD_RE = /([A-Za-z']+)|([^A-Za-z']+)/g;

function applyAccent(word: string, subs: Record<string, string>): string {
  let out = word;
  for (const [k, v] of Object.entries(subs)) {
    out = out.split(k).join(v);
  }
  return out;
}

function garble(
  text: string,
  def: LangDef,
  skill: number,
): string {
  const tier = tierFor(skill);
  if (tier.bucket === 4) return text;

  let result = "";
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[1];
    if (!word) {
      result += match[0];
      continue;
    }

    const seed = seedFor(word, def.name, tier.bucket);
    const rng = mulberry32(seed);

    if (tier.passThrough > 0 && rng() < tier.passThrough) {
      result += tier.accent && def.accentSubs
        ? applyAccent(word, def.accentSubs)
        : word;
      continue;
    }

    let fake: string;
    if (def.mode === "markov") {
      const approxLen = tier.preserveLength ? word.length : undefined;
      fake = genWordMarkov(
        def.markovCorpus ?? [],
        def.markovOrder ?? 2,
        rng,
        approxLen,
      );
    } else {
      const targetSyllables = tier.preserveLength
        ? syllableCountFor(word.length)
        : undefined;
      fake = genWord(def, rng, targetSyllables);
    }
    result += applyCapitalization(fake, word, def.capitalize ?? "first");
  }
  return result;
}

// ─── end inlined garble engine ────────────────────────────────────────────


// ─── sgp-language baked language defs (regenerated on +language/reload) ───
const LANG_DEFS = {"arabic":{"schema":1,"name":"arabic","mode":"phoneme","description":"Semitic — guttural kh/gh/q, triliteral CVC feel.","onsets":["b","t","th","j","h","kh","d","dh","r","r","z","s","s","sh","s","d","t","z","gh","f","q","q","k","k","l","l","m","m","n","n","h","w","y","ham"],"nuclei":["a","a","a","i","i","u","u","aa","aa","ii","uu","ai","au","ay","aw"],"codas":["","b","t","d","r","z","s","sh","f","q","k","l","m","m","n","n","h","w","y","kh"],"syllablePatterns":["CV","CVC","CVC","CV","V","CVCC"],"wordLenWeights":[0,2,4,3,2,1],"capitalize":"first","accentSubs":{"p":"b","v":"f","g":"gh","c":"k","x":"ks"}},"dwarven":{"schema":1,"name":"dwarven","mode":"markov","description":"Harsh, gutteral Dwarven tongue (Khuzdul).","markovCorpus":["khazad","dum","gabilgathol","belegost","nogrod","kibil","nala","baraz","ziril","bundushathur","shathur","azanulbizar","nurn","erebor","thorin","balin","dwalin","fili","kili","oin","gloin","gimli","durin","thrain","thror","dain","nain","fundin","groin","bofur","bifur","bombur","khuzdul","mahal","agh","baruk","khazadai"],"markovOrder":2,"capitalize":"first"},"elvish":{"schema":1,"name":"elvish","mode":"phoneme","description":"Flowing Elven speech — soft consonants, musical vowels.","onsets":["l","th","v","s","f","r","m","n","ch","h","y"],"nuclei":["ae","ia","e","i","o","a","u","ea"],"codas":["th","s","l","r","n","m","th",""],"syllablePatterns":["CV","CV","CVC","CCV"],"wordLenWeights":[0,1,4,3,2,1],"capitalize":"first","accentSubs":{"r":"lh","s":"th"}},"first-tongue":{"schema":1,"name":"first-tongue","mode":"phoneme","description":"Guttural, harsh spirit language of the Uratha — growls, clicks, and sibilants.","onsets":["kh","gh","sh","th","z","r","h","ch","k","g","ur","v"],"nuclei":["a","u","i","aa","ur","uh","o"],"codas":["kh","gh","sh","r","z","th","h","k","g",""],"syllablePatterns":["CV","CVC","CV","CVC"],"wordLenWeights":[0,1,3,4,2,1],"capitalize":"first","accentSubs":{"s":"sh","f":"kh"}},"french":{"schema":1,"name":"french","mode":"phoneme","description":"Gallic Romance — nasal vowels, soft fricatives, mute endings.","onsets":["b","c","ch","d","f","g","j","j","l","l","m","m","n","n","p","ph","qu","r","r","s","s","t","v","v","z","zh","br","bl","cr","cl","dr","fr","fl","gr","gl","pr","pl","tr","vr"],"nuclei":["a","a","e","e","e","i","i","o","o","u","u","ou","eu","oi","ai","ei","an","an","en","in","on","on","un","eau","au"],"codas":["","","","","n","r","r","l","s","t","x","e"],"syllablePatterns":["CV","CV","CV","CVC","V","CCV"],"wordLenWeights":[0,1,3,4,3,2],"capitalize":"first","accentSubs":{"th":"z","w":"v","sh":"ch","h":"","j":"zh"}},"german":{"schema":1,"name":"german","mode":"phoneme","description":"West Germanic — harsh fricatives, compound feel, umlauts.","onsets":["b","d","f","g","h","j","k","k","l","m","n","p","r","s","s","t","t","v","w","z","ch","sch","pf","ts","qu","bl","br","dr","fl","fr","gl","gr","kl","kn","kr","pl","pr","schm","schn","schr","schw","sp","st","str","tr","zw"],"nuclei":["a","a","e","e","i","i","o","o","u","u","ie","ei","ai","au","eu","ae","oe","ue","aa","oo"],"codas":["","n","n","t","t","r","r","s","s","ch","ck","m","l","f","g","b","d","st","nd","ng","cht"],"syllablePatterns":["CV","CV","CVC","CVC","CCV","CCVC","V"],"wordLenWeights":[0,2,3,4,3,2,1],"capitalize":"first","accentSubs":{"th":"d","v":"f","w":"v","sh":"sch","c":"k"}},"greek":{"schema":1,"name":"greek","mode":"phoneme","description":"Hellenic — aspirates, clusters, -os/-on endings.","onsets":["b","g","d","th","k","l","m","n","x","p","r","s","t","ph","kh","ps","z","br","bl","gr","gl","dr","th","kr","kl","pr","pl","tr","sp","st","sk","str","phr","khr"],"nuclei":["a","a","e","e","i","i","o","o","u","y","ai","ei","oi","au","eu","ou","ia","io"],"codas":["","n","n","s","s","r","x","m","os","on","as","es","is","ou"],"syllablePatterns":["CV","CV","CVC","CCV","CCVC","V"],"wordLenWeights":[0,1,3,4,3,1],"capitalize":"first","accentSubs":{"c":"k","w":"v","sh":"s","j":"i","qu":"k"}},"high-speech":{"schema":1,"name":"high-speech","mode":"phoneme","description":"Flowing, resonant celestial tongue of Atlantis used by Mages to cast Vulgar spells.","onsets":["ph","th","l","m","n","r","s","v","y","ch","h"],"nuclei":["ae","ia","o","u","i","a","ea"],"codas":["th","s","l","r","n","m","ph",""],"syllablePatterns":["CV","CV","CVC","CCV"],"wordLenWeights":[0,1,4,3,2,1],"capitalize":"first","accentSubs":{"z":"s","k":"ch"}},"huttese":{"schema":1,"name":"huttese","mode":"phoneme","description":"Slow, drawled trade language — open syllables, sibilants.","onsets":["b","p","t","d","k","g","ch","sh","m","n","w","y"],"nuclei":["a","o","u","ee","i","ai","oo"],"codas":["","","","k","n","sh","ta"],"syllablePatterns":["CV","CV","CVC","V"],"wordLenWeights":[0,1,4,4,2,1],"capitalize":"first","accentSubs":{"s":"sh","th":"t","f":"p"}},"italian":{"schema":1,"name":"italian","mode":"phoneme","description":"Italo-Romance — musical open vowels, soft c/g, vowel endings.","onsets":["b","c","ch","d","f","g","gh","l","l","m","m","n","n","p","p","qu","r","r","s","s","sc","t","t","v","z","br","bl","cr","cl","dr","fr","fl","gr","gl","pr","pl","tr","str","spr"],"nuclei":["a","a","a","e","e","e","i","i","o","o","o","u","ia","ie","io","iu","ua","ue","uo","ai","ei","oi"],"codas":["","","","","n","n","r","l","s","t","o","a","e","i"],"syllablePatterns":["CV","CV","CV","CV","CVC","V","CCV"],"wordLenWeights":[0,1,3,4,3,2],"capitalize":"first","accentSubs":{"th":"t","w":"v","sh":"sc","x":"s","y":"i"}},"japanese":{"schema":1,"name":"japanese","mode":"phoneme","description":"Japonic — strict open CV syllables, light n coda only.","onsets":["k","k","g","s","s","z","sh","j","t","t","d","ch","n","n","h","b","p","m","m","y","r","r","r","w","ky","gy","sh","ch","ny","hy","by","py","my","ry"],"nuclei":["a","a","a","i","i","i","u","u","e","e","o","o","o","aa","ii","uu","ee","oo","ai","ei","ou"],"codas":["","","","","","n","n","n"],"syllablePatterns":["CV","CV","CV","CV","V","CVC"],"wordLenWeights":[0,1,3,4,3,2,1],"capitalize":"first","accentSubs":{"l":"r","th":"s","v":"b","f":"h","si":"shi","ti":"chi","w":"u"}},"latin":{"schema":1,"name":"latin","mode":"phoneme","description":"Classical Latin — crisp consonants, five vowels, -us/-um feel.","onsets":["b","c","d","f","g","h","j","l","m","n","p","q","r","s","t","v","br","bl","cr","cl","dr","fl","fr","gl","gr","pl","pr","tr","sp","st","sc","str"],"nuclei":["a","a","a","e","e","i","i","o","o","u","u","ae","oe","au","ei","ui"],"codas":["","","s","s","m","m","n","t","r","x","l","d","us","um","is","em","am"],"syllablePatterns":["CV","CV","CVC","CVC","V","CCV","CCVC"],"wordLenWeights":[0,1,3,4,3,2],"capitalize":"first","accentSubs":{"th":"t","w":"v","sh":"s","k":"c","y":"i"}},"mandarin":{"schema":1,"name":"mandarin","mode":"phoneme","description":"Sinitic — compact CV syllables, retroflex and palatal onsets.","onsets":["b","p","m","f","d","t","n","l","g","k","h","j","q","x","zh","ch","sh","r","z","c","s","y","w","b","d","g","j","zh","sh"],"nuclei":["a","a","e","e","i","i","o","o","u","u","ue","ai","ei","ao","ou","an","en","ang","eng","ong","ia","ie","iao","iu","ian","in","iang","ing","ua","uo","uai","ui","uan","un","uang"],"codas":["","","","","n","n","ng","ng","r"],"syllablePatterns":["CV","CV","CV","CVC","V","V"],"wordLenWeights":[0,3,4,2,1],"capitalize":"first","accentSubs":{"th":"s","v":"w","r":"l","si":"xi","shi":"xi"}},"portuguese":{"schema":1,"name":"portuguese","mode":"phoneme","description":"Ibero-Romance — nasal diphthongs, lh/nh, open-closed vowels.","onsets":["b","c","ch","d","f","g","h","j","l","lh","m","m","n","nh","p","p","qu","r","r","rr","s","s","t","t","v","x","z","br","bl","cr","cl","dr","fr","fl","gr","gl","pr","pl","tr"],"nuclei":["a","a","e","e","i","i","o","o","u","ao","ae","oe","ai","ei","oi","ui","ia","ie","io","ua","ue","uo","am","em","im","om","um","ao"],"codas":["","","","m","m","n","s","s","r","l","z","x"],"syllablePatterns":["CV","CV","CV","CVC","V","CCV"],"wordLenWeights":[0,1,3,4,3,1],"capitalize":"first","accentSubs":{"th":"t","w":"u","sh":"x","y":"i","ll":"lh"}},"russian":{"schema":1,"name":"russian","mode":"phoneme","description":"East Slavic — dense clusters, palatals, hard kh/shch.","onsets":["b","v","g","d","zh","z","k","k","l","m","n","p","r","s","s","t","t","f","kh","ts","ch","sh","shch","y","bl","br","vl","vr","gl","gr","dl","dr","kl","kr","pl","pr","sl","sm","sn","sp","st","sv","tr","tv","sk","skv","str"],"nuclei":["a","a","e","i","i","o","o","o","u","y","ya","ye","yu","yo","ai","oi"],"codas":["","n","n","t","t","k","k","v","r","l","s","sh","kh","m","p","st","sk"],"syllablePatterns":["CV","CV","CVC","CVC","CCV","CCV","CCVC","V"],"wordLenWeights":[0,2,4,3,2,1],"capitalize":"first","accentSubs":{"th":"z","w":"v","h":"kh","j":"zh","x":"ks"}},"shyriiwook":{"schema":1,"name":"shyriiwook","mode":"phoneme","description":"Wookiee speech — growling, throat-heavy syllables.","onsets":["k","g","r","rr","gr","kr","wr","hr","ng","h","w"],"nuclei":["aa","uu","oo","ah","rr","oa","ow"],"codas":["k","rr","gh","h","rk","ngh",""],"syllablePatterns":["CV","CVC","CCV","CCVC","CV"],"wordLenWeights":[0,2,4,3,2,1],"capitalize":"first","accentSubs":{"s":"rh","th":"k","ee":"uu"}},"spanish":{"schema":1,"name":"spanish","mode":"phoneme","description":"Iberian Romance — open syllables, rolled r, clear vowels.","onsets":["b","b","c","ch","d","d","f","g","h","j","l","l","ll","m","m","n","n","ny","p","p","qu","r","r","rr","s","s","s","t","t","v","y","z","br","bl","cr","cl","dr","fr","fl","gr","gl","pr","pl","tr"],"nuclei":["a","a","a","e","e","e","i","i","o","o","o","u","ia","ie","io","ua","ue","uo","ai","ei","oi"],"codas":["","","","","n","n","s","s","r","r","l","d","z","y"],"syllablePatterns":["CV","CV","CV","CVC","V","CCV"],"wordLenWeights":[0,1,3,4,3,1],"capitalize":"first","accentSubs":{"th":"t","w":"gu","sh":"ch","v":"b","ph":"f"}},"sylvan":{"schema":1,"name":"sylvan","mode":"phoneme","description":"Sylvan elven — flowing liquids and long vowels.","onsets":["l","n","m","v","th","f","s","el","an","y","br","gl"],"nuclei":["a","e","i","o","ae","ia","io","ea"],"codas":["","l","n","r","s","th","el","il"],"syllablePatterns":["CV","CVC","V","CV"],"wordLenWeights":[0,1,3,5,3,1],"capitalize":"first","accentSubs":{"k":"c","w":"v"}}};
// ─── end baked language defs ──────────────────────────────────────────────

async function _readActive(o: IDBObj): Promise<string | undefined> {
  const langs = (o.state as Record<string, unknown>)?.languages as
    | Record<string, unknown>
    | undefined;
  const a = langs?.active;
  const ctx = { player: o, active: typeof a === "string" ? a.toLowerCase() : undefined };
  await gameHooks.emit("language:get_active", ctx);
  return ctx.active;
}

async function _skillIn(o: IDBObj, name: string): Promise<number> {
  const langs = (o.state as Record<string, unknown>)?.languages as
    | Record<string, unknown>
    | undefined;
  const known = langs?.known as Record<string, unknown> | undefined;
  const v = known?.[name.toLowerCase()];
  let baseSkill = 0;
  if (typeof v === "number" && Number.isFinite(v)) {
    baseSkill = Math.max(0, Math.min(100, Math.floor(v)));
  }
  const ctx = { player: o, language: name.toLowerCase(), skill: baseSkill };
  await gameHooks.emit("language:get_skill", ctx);
  return Math.max(0, Math.min(100, Math.floor(ctx.skill)));
}

export default async (u: IUrsamuSDK) => {
  const rawArg = (u.cmd.args[0] ?? u.cmd.original ?? "").toString();
  const msg = u.util.stripSubs(rawArg).trim();
  if (!msg) {
    u.send("Say what?");
    return;
  }

  const speakerName = u.util.displayName(u.me, u.me);
  const active = await _readActive(u.me);

  if (!active) {
    u.send(`You say, "${msg}"`);
    u.here.broadcast(`${speakerName} says, "${msg}"`, { except: u.me.id });
    return;
  }

  // deno-lint-ignore no-explicit-any
  let def = (LANG_DEFS as Record<string, any>)[active];
  if (!def) {
    def = {
      schema: 1,
      name: active,
      mode: "phoneme",
      description: `Default generated language for ${active}`,
      onsets: ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "r", "s", "t", "v", "w", "y"],
      nuclei: ["a", "e", "i", "o", "u"],
      codas: ["t", "s", "n", "r", "m", ""],
      syllablePatterns: ["CV", "CVC"],
      wordLenWeights: [0, 1, 4, 3, 2, 1],
      capitalize: "first"
    };
  }

  u.send(`You say in ${active}, "${msg}"`);
  const listeners = (u.here.contents ?? []).filter(
    (o: IDBObj) => o.flags.has("connected") && o.id !== u.me.id,
  );
  for (const listener of listeners) {
    const skill = await _skillIn(listener, active);
    const text = garble(msg, def, skill);
    u.send(`${speakerName} says in ${active}, "${text}"`, listener.id);

    // Passive learning: 10% chance to gain 1 skill point, up to 50
    if (skill < 50 && Math.random() < 0.10) {
      const newSkill = skill + 1;
      const key = active.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (key) {
        // deno-lint-ignore no-explicit-any
        const state = listener.state as Record<string, any>;
        if (!state.languages) state.languages = { known: {} };
        if (!state.languages.known) state.languages.known = {};
        state.languages.known[key] = newSkill;
        await u.db.modify(listener.id, "$set", {
          [`data.languages.known.${key}`]: newSkill,
        });
      }
    }
  }
};
