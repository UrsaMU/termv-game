import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import { gameHooks } from "@ursamu/ursamu";

/**
 * sgp-language: pose.ts
 *
 * Overrides the engine's stock `pose` (and `;` semipose). Action text
 * outside double-quoted spans passes through unchanged. Spans inside
 * "..." are garbled per-listener using the speaker's active language.
 * Speaker always sees their own pose clearly.
 */

export const aliases = ["pose", ":", ";"];

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
const LANG_DEFS = {"dwarven":{"schema":1,"name":"dwarven","mode":"markov","description":"Harsh, gutteral Dwarven tongue (Khuzdul).","markovCorpus":["khazad","dum","gabilgathol","belegost","nogrod","kibil","nala","baraz","ziril","bundushathur","shathur","azanulbizar","nurn","erebor","thorin","balin","dwalin","fili","kili","oin","gloin","gimli","durin","thrain","thror","dain","nain","fundin","groin","bofur","bifur","bombur","khuzdul","mahal","agh","baruk","khazadai"],"markovOrder":2,"capitalize":"first"},"elvish":{"schema":1,"name":"elvish","mode":"phoneme","description":"Flowing Elven speech — soft consonants, musical vowels.","onsets":["l","th","v","s","f","r","m","n","ch","h","y"],"nuclei":["ae","ia","e","i","o","a","u","ea"],"codas":["th","s","l","r","n","m","th",""],"syllablePatterns":["CV","CV","CVC","CCV"],"wordLenWeights":[0,1,4,3,2,1],"capitalize":"first","accentSubs":{"r":"lh","s":"th"}},"huttese":{"schema":1,"name":"huttese","mode":"phoneme","description":"Slow, drawled trade language — open syllables, sibilants.","onsets":["b","p","t","d","k","g","ch","sh","m","n","w","y"],"nuclei":["a","o","u","ee","i","ai","oo"],"codas":["","","","k","n","sh","ta"],"syllablePatterns":["CV","CV","CVC","V"],"wordLenWeights":[0,1,4,4,2,1],"capitalize":"first","accentSubs":{"s":"sh","th":"t","f":"p"}},"shyriiwook":{"schema":1,"name":"shyriiwook","mode":"phoneme","description":"Wookiee speech — growling, throat-heavy syllables.","onsets":["k","g","r","rr","gr","kr","wr","hr","ng","h","w"],"nuclei":["aa","uu","oo","ah","rr","oa","ow"],"codas":["k","rr","gh","h","rk","ngh",""],"syllablePatterns":["CV","CVC","CCV","CCVC","CV"],"wordLenWeights":[0,2,4,3,2,1],"capitalize":"first","accentSubs":{"s":"rh","th":"k","ee":"uu"}},"sylvan":{"schema":1,"name":"sylvan","mode":"phoneme","description":"Sylvan elven — flowing liquids and long vowels.","onsets":["l","n","m","v","th","f","s","el","an","y","br","gl"],"nuclei":["a","e","i","o","ae","ia","io","ea"],"codas":["","l","n","r","s","th","el","il"],"syllablePatterns":["CV","CVC","V","CV"],"wordLenWeights":[0,1,3,5,3,1],"capitalize":"first","accentSubs":{"k":"c","w":"v"}}};
// ─── end baked language defs ──────────────────────────────────────────────

async function _readActive(o: IDBObj): Promise<string | undefined> {
  const langs = (o.state as Record<string, unknown>)?.languages as
    | Record<string, unknown>
    | undefined;
  let a = langs?.active;
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

function _renderQuoted(text: string, def: unknown, skill: number): string {
  return text.replace(
    /"([^"]*)"/g,
    (_, inner) =>
      `"${garble(inner, def as Parameters<typeof garble>[1], skill)}"`,
  );
}

export default async (u: IUrsamuSDK) => {
  const rawArg = (u.cmd.args[0] ?? u.cmd.original ?? "").toString();
  const msg = u.util.stripSubs(rawArg);
  if (!msg.trim()) {
    u.send("Pose what?");
    return;
  }

  const isSemi =
    u.cmd.name === ";" || (u.cmd.original ?? "").startsWith(";");
  const join = isSemi ? "" : " ";
  const speakerName = u.util.displayName(u.me, u.me);
  const active = await _readActive(u.me);

  if (!active || !msg.includes("\"")) {
    const line = `${speakerName}${join}${msg.trim()}`;
    u.send(line);
    u.here.broadcast(line, { except: u.me.id });
    return;
  }

  // deno-lint-ignore no-explicit-any
  const def = (LANG_DEFS as Record<string, any>)[active];
  if (!def) {
    const line = `${speakerName}${join}${msg.trim()}`;
    u.send(line);
    u.here.broadcast(line, { except: u.me.id });
    return;
  }

  u.send(`${speakerName}${join}${msg.trim()}`);
  const listeners = (u.here.contents ?? []).filter(
    (o: IDBObj) => o.flags.has("connected") && o.id !== u.me.id,
  );
  for (const listener of listeners) {
    const skill = await _skillIn(listener, active);
    const rendered = _renderQuoted(msg.trim(), def, skill);
    u.send(`${speakerName}${join}${rendered}`, listener.id);

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
