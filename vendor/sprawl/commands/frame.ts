/**
 * Structured command frames for the Sprawl Goons client.
 *
 * Rule: add the JSON payload here first. The Flutter / cyber-d6
 * interface is updated only after this contract exists.
 *
 * Telnet still gets chrome text. Web/Flutter sessions get
 * `{ type: "layout", meta: { type: "sprawl", kind, data } }`.
 */
import type { IUrsamuSDK, IDBObj } from "@ursamu/ursamu";
import { readStats, type ISprawlChar } from "../db/schemas.ts";
import type { IActionResult } from "../engine/action.ts";
import { find } from "../engine/catalog.ts";
import {
  displayName,
  itemData,
  presentedItemKind,
  repairItemData,
} from "../engine/items.ts";
import { plain } from "./chrome.ts";
import { shortStat } from "./attack-shared.ts";

export const SPRAWL_UI = "sprawl";

export type SprawlKind =
  | "sheet"
  | "roll"
  | "fight"
  | "notice"
  | "gear"
  | "net"
  | "gig"
  | "desc"
  | "market"
  | "flow"
  | "haunt"
  | "ping"
  | "payout";

export type SheetGearRow = {
  name: string;
  load: number;
  slot: string;
};

export type SheetAugRow = {
  slug: string;
  name: string;
};

export type SheetPayload = {
  name: string;
  role: string;
  status: "LIVE" | "DRAFT" | "SUBMITTED" | "REVISION";
  stats: {
    morphology: number;
    equilibrium: number;
    reaction: number;
    cognition: number;
    affinity: number;
  };
  resilience: number;
  resilienceMax: number;
  load: number;
  loadMax: number;
  cash: number;
  ap: number;
  apTotal: number;
  level: number;
  edge: string;
  background: string;
  quirks: string[];
  affectations: string[];
  note: string;
  augs: SheetAugRow[];
  gear: SheetGearRow[];
  critical: {
    location: string;
    severity: number;
    effect: string;
  } | null;
};

export function prefersSprawlJson(u: IUrsamuSDK): boolean {
  return u.clientType === "web" &&
    typeof u.ui?.layout === "function";
}

export type RollPayload = {
  verb: "roll" | "attack";
  title: string;
  stat: string;
  statShort: string;
  statValue: number;
  bonuses: number;
  total: number;
  ds: number;
  success: boolean;
  margin: number;
  damageToTarget: number;
  damageToSelf: number;
  needNerveCheck: boolean;
  mode: string;
  dice: number[];
  kept: number[];
  explodeBonus: number;
  doubleSix: boolean;
  doubleOne: boolean;
  parts: string[];
  flavor: string;
  target: string;
  /** Replay this exact command (AGAIN). */
  line?: string;
};

export type FightPayload = {
  verb: string;
  ok: boolean;
  who: string;
  resilience: number;
  resilienceMax: number;
  amount: number;
  note: string;
  critical: {
    location: string;
    severity: number;
    effect: string;
  } | null;
};

export type GearFitPayload = {
  slug: string;
  name: string;
  effect: string;
  bonus?: number;
  tags: string[];
};

export type GearAmmoPayload = {
  slug: string;
  name: string;
};

export type GearItemPayload = {
  name: string;
  slug: string;
  slot: string;
  load: number;
  mods: string;
  use: boolean;
  kind: string;
  bonus?: number;
  mag?: number;
  magMax?: number;
  ammo: GearAmmoPayload | null;
  fittings: GearFitPayload[];
};

export type GearPayload = {
  load: number;
  loadMax: number;
  items: GearItemPayload[];
};

export type NetSoftPayload = {
  name: string;
  slug: string;
  effect: string;
  obsolete: boolean;
};

export type NetPayload = {
  hull: string;
  firewall: number;
  aiCog: number;
  ram: number;
  ramMax: number;
  slots: number;
  slotsMax: number;
  software: NetSoftPayload[];
  exploits: Array<{ name: string; slug: string; note: string }>;
  penalties: Array<{ name: string; note: string }>;
  heat: number;
};

export type GigPayload = {
  id: string;
  title: string;
  blurb: string;
  tier: string;
  objective: string;
  venueName: string;
  bossName: string;
  bossDs: number;
  targetName: string;
  node: number;
  nodesMax: number;
  roomName: string;
  roomDesc: string;
  payoutMult: number;
  returnRoomId: string;
  nodeCleared: boolean;
  status: string;
  token: boolean;
  onSite: boolean;
  payoutBy: number;
  payoutAp: number;
  /** Mid-run: node clear, can +gig/push / Deeper. */
  canAdvance?: boolean;
  /** One-line next beat for desk / feed. */
  nextHint?: string;
};

export type MarketStatPayload = {
  label: string;
  value: string;
};

export type MarketItemPayload = {
  slug: string;
  name: string;
  price: number;
  spec: string;
  category: string;
  stock: string;
  image: string;
  blurb: string;
  kind: string;
  book: string;
  tags: string[];
  stats: MarketStatPayload[];
};

export type MarketPayload = {
  cash: number;
  items: MarketItemPayload[];
};

export type FlowDistrictPayload = {
  slug: string;
  name: string;
  grid: string;
  blurb: string;
  /** Client art URL for the Map district card. */
  image?: string;
  /** Bound game room id when staff linked a room. */
  roomId?: string;
  /** Players may jack in only when open. */
  open?: boolean;
};

export type FlowPayload = {
  districts: FlowDistrictPayload[];
};

export type HauntPayload = {
  hangouts: Array<{
    slug: string;
    name: string;
    kind: string;
    blurb: string;
    image?: string;
    roomId?: string;
    open: boolean;
  }>;
};

export function emitSprawl(
  u: IUrsamuSDK,
  kind: SprawlKind,
  data: object,
  text: string,
): void {
  if (prefersSprawlJson(u)) {
    u.ui.layout({
      components: [
        { type: "header", title: kind.toUpperCase() },
        { type: "text", content: plain(text) },
      ],
      meta: { type: SPRAWL_UI, kind, data },
    });
    return;
  }
  u.send(text);
}

export function buildGearItem(obj: IDBObj): GearItemPayload {
  const raw = itemData(obj);
  const d = raw
    ? repairItemData(raw, { name: displayName(obj) }).data
    : null;
  const bits: string[] = [];
  if (d?.bonus) bits.push(`+${d.bonus}`);
  for (const mod of d?.statMods ?? []) {
    bits.push(`${mod.stat} ${mod.mod >= 0 ? "+" : ""}${mod.mod}`);
  }
  if (d?.notes) bits.push(String(d.notes));
  return {
    name: displayName(obj),
    slug: d?.slug ?? "",
    slot: String(d?.slot ?? "carried"),
    load: d?.load ?? 0,
    mods: bits.join(" · "),
    use: !!(d?.useEffect || (d?.uses != null && d.uses > 0)),
    kind: d ? presentedItemKind(d, displayName(obj)) : "",
    bonus: d?.bonus,
    mag: d?.mag,
    magMax: d?.magMax,
    ammo: d?.ammoSlug
      ? {
        slug: String(d.ammoSlug),
        name: String(
          find("ammo", String(d.ammoSlug))?.name ?? d.ammoSlug,
        ),
      }
      : null,
    fittings: (d?.mods ?? []).map((m) => ({
      slug: String(m.slug ?? ""),
      name: String(m.name || m.slug || "mod"),
      effect: String(m.effect ?? ""),
      bonus: m.bonus,
      tags: [...(m.tags ?? [])],
    })),
  };
}

export function buildGearPayload(
  load: number,
  loadMax: number,
  items: IDBObj[],
): GearPayload {
  return {
    load,
    loadMax,
    items: items.map(buildGearItem),
  };
}

export function sheetGear(items: IDBObj[]): SheetGearRow[] {
  return items.map((obj) => {
    const d = itemData(obj);
    return {
      name: displayName(obj),
      load: d?.load ?? 0,
      slot: String(d?.slot ?? "carried"),
    };
  });
}

export function sheetStatus(c: ISprawlChar): SheetPayload["status"] {
  if (c.chargenComplete || c.chargenStatus === "approved") return "LIVE";
  if (c.chargenStatus === "submitted") return "SUBMITTED";
  if (c.chargenStatus === "revision") return "REVISION";
  return "DRAFT";
}

export function buildSheetPayload(
  c: ISprawlChar,
  opts: {
    name: string;
    load: number;
    loadMax: number;
    gear: SheetGearRow[];
  },
): SheetPayload {
  const crit = c.critical;
  return {
    name: opts.name,
    role: (c.backgroundName || "GOON").toUpperCase(),
    status: sheetStatus(c),
    stats: readStats(c.stats),
    resilience: c.resilience,
    resilienceMax: c.resilienceMax,
    load: opts.load,
    loadMax: opts.loadMax,
    cash: c.bityuan,
    ap: c.ap,
    apTotal: c.apTotal ?? 0,
    level: c.level,
    edge: c.edgeName || "",
    background: c.backgroundName || "",
    quirks: [...c.quirks],
    affectations: [...c.affectations],
    note: String(c.notes ?? "").trim(),
    augs: c.augs.map((a) => ({ slug: a.slug, name: a.name })),
    gear: opts.gear,
    critical: crit
      ? {
        location: crit.location,
        severity: crit.severity,
        effect: crit.effect,
      }
      : null,
  };
}

export function buildRollPayload(
  r: IActionResult,
  opts: {
    verb?: "roll" | "attack";
    title?: string;
    parts?: string[];
    flavor?: string;
    target?: string;
    line?: string;
  } = {},
): RollPayload {
  return {
    verb: opts.verb ?? "roll",
    title: opts.title ?? "ACTION ROLL",
    stat: r.stat,
    statShort: shortStat(r.stat),
    statValue: r.statValue,
    bonuses: r.bonuses,
    total: r.total,
    ds: r.ds,
    success: r.success,
    margin: r.margin,
    damageToTarget: r.damageToTarget,
    damageToSelf: r.damageToSelf,
    needNerveCheck: r.needNerveCheck,
    mode: r.mode,
    dice: [...r.dice.dice],
    kept: [...r.dice.kept],
    explodeBonus: r.dice.explodeBonus,
    doubleSix: r.dice.doubleSix,
    doubleOne: r.dice.doubleOne,
    parts: [...(opts.parts ?? r.tags)],
    flavor: opts.flavor ?? "",
    target: opts.target ?? "",
    line: opts.line,
  };
}

export function buildFightPayload(opts: {
  verb: string;
  ok?: boolean;
  who: string;
  resilience: number;
  resilienceMax: number;
  amount?: number;
  note?: string;
  critical?: ISprawlChar["critical"];
}): FightPayload {
  const crit = opts.critical;
  return {
    verb: opts.verb,
    ok: opts.ok !== false,
    who: opts.who,
    resilience: opts.resilience,
    resilienceMax: opts.resilienceMax,
    amount: opts.amount ?? 0,
    note: opts.note ?? "",
    critical: crit
      ? {
        location: crit.location,
        severity: crit.severity,
        effect: crit.effect,
      }
      : null,
  };
}
