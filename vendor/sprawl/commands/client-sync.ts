/**
 * Build and emit live client frames. Commands still send telnet
 * chrome via emitSprawl's text path.
 */
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import type { IActiveGig, ISprawlChar } from "../db/schemas.ts";
import { SOFTWARE, find, type Row } from "../engine/catalog.ts";
import { districtCatalog } from "../engine/districts.ts";
import {
  gigCanAdvance,
  gigNextHint,
} from "../engine/gig-run.ts";
import { hangoutCatalog } from "../engine/hangouts.ts";
import { bankedExploits, resolveNetExploit } from "../engine/exploit-inv.ts";
import { isPersonalGear } from "../engine/vehicles.ts";
import { itemData } from "../engine/items.ts";
import { marketStock } from "../engine/market-stock.ts";
import {
  consoleSpec,
  freeSoftwareSlots,
  usedSoftwareSlots,
} from "../engine/net.ts";
import { netStatusLines } from "../engine/net-state.ts";
import { getChar, getInventory } from "../engine/sheet-io.ts";
import { effectiveLoadoutMax } from "../engine/worn-gear.ts";
import {
  buildGearPayload,
  emitSprawl,
  type FlowPayload,
  type GigPayload,
  type HauntPayload,
  type MarketPayload,
  type NetPayload,
} from "./frame.ts";

export async function emitGearFrame(
  u: IUrsamuSDK,
  text: string,
): Promise<void> {
  const { items, load } = await getInventory(u, u.me);
  const gear = items.filter((o) => isPersonalGear(itemData(o)));
  const c = getChar(u.me);
  const loadMax = effectiveLoadoutMax(c?.loadoutMax ?? 10, items);
  emitSprawl(u, "gear", buildGearPayload(load, loadMax, gear), text);
}

export function buildNetPayload(c: ISprawlChar): NetPayload {
  const spec = consoleSpec(c);
  const used = usedSoftwareSlots(c);
  const free = freeSoftwareSlots(c);
  const obs = new Set(c.softwareObsolete ?? []);
  const software = (c.software ?? []).map((slug) => {
    const row = find("software", slug) ??
      SOFTWARE.find((r) => r.slug === slug);
    return {
      slug,
      name: String(row?.name ?? slug),
      effect: String(row?.blurb ?? row?.notes ?? row?.effect ?? ""),
      obsolete: obs.has(slug),
    };
  });
  const exploits = bankedExploits(c).map((slug) => {
    const row = resolveNetExploit(slug);
    return {
      slug,
      name: String(row?.name ?? slug),
      note: String(row?.blurb ?? ""),
    };
  });
  const penalties = netStatusLines(c).map((note) => ({
    name: note.split(" ")[0]?.toUpperCase() ?? "NET",
    note,
  }));
  return {
    hull: spec?.name ?? "NONE",
    firewall: spec?.firewall ?? 0,
    aiCog: (spec?.hullAi ?? 0) + (spec?.aiCog ?? 0),
    ram: spec?.ram ?? 0,
    ramMax: spec ? spec.baseRam + spec.ramBonus : 0,
    slots: used,
    slotsMax: used + free,
    software,
    exploits,
    penalties,
    heat: c.net?.heat ?? 0,
  };
}

export function emitNetFrame(
  u: IUrsamuSDK,
  c: ISprawlChar,
  text: string,
): void {
  emitSprawl(u, "net", buildNetPayload(c), text);
}

export function buildGigPayload(
  g: IActiveGig,
  extra: Partial<GigPayload> = {},
): GigPayload {
  const base: GigPayload = {
    id: g.id,
    title: g.title,
    blurb: g.blurb ?? "",
    tier: g.tier,
    objective: g.objective,
    venueName: g.venueName,
    bossName: g.bossName,
    bossDs: g.bossDs,
    targetName: g.targetName ?? "",
    node: g.node ?? 1,
    nodesMax: g.nodesMax ?? 1,
    roomName: g.roomName ?? "",
    roomDesc: g.roomDesc ?? g.roomBlurb ?? "",
    payoutMult: g.payoutMult ?? 1,
    returnRoomId: g.returnRoomId ?? "",
    nodeCleared: !!g.nodeCleared,
    status: extra.status ?? g.status,
    token: !!(g.tokenId || g.status === "token" || extra.token),
    onSite: extra.onSite ??
      (g.status !== "left" && !!g.siteRoomId),
    payoutBy: extra.payoutBy ?? 0,
    payoutAp: extra.payoutAp ?? 0,
    canAdvance: gigCanAdvance(g),
    nextHint: gigNextHint(g),
  };
  return { ...base, ...extra };
}

export function emitGigFrame(
  u: IUrsamuSDK,
  g: IActiveGig,
  text: string,
  extra: Partial<GigPayload> = {},
): void {
  emitSprawl(u, "gig", buildGigPayload(g, extra), text);
}

export function emitGigAbandoned(u: IUrsamuSDK, text: string): void {
  emitSprawl(
    u,
    "gig",
    { id: "abandoned", title: "ABANDONED", status: "abandoned" },
    text,
  );
}

export function emitPayout(
  u: IUrsamuSDK,
  data: {
    kind: "kill" | "gig" | "hack";
    label: string;
    bityuan: number;
    ap: number;
  },
  text: string,
): void {
  emitSprawl(u, "payout", data, text);
}

function marketSpec(row: Row): string {
  const bits: string[] = [];
  if (row.category) bits.push(String(row.category));
  if (row.bonus != null) bits.push(`+${row.bonus}`);
  if (row.mag != null || row.magMax != null) {
    bits.push(`mag ${row.magMax ?? row.mag}`);
  }
  if (row.rangeM != null) bits.push(`${row.rangeM} m`);
  if (row.load != null) bits.push(`load ${row.load}`);
  if (row.slots != null) bits.push(`${row.slots} slots`);
  if (row.ram != null) bits.push(`RAM ${row.ram}`);
  return bits.join(" · ");
}

function marketBlurb(row: Row): string {
  const catalog = String(row.blurb ?? row.notes ?? row.effect ?? "").trim();
  if (catalog) return catalog;
  const name = String(row.name ?? "This piece").replace(/®/g, "").replace(/\s+/g, " ").trim();
  const cat = String(row.category ?? row.kind ?? "").toLowerCase();
  const kind = String(row.kind ?? "").toLowerCase();
  const bonus = row.bonus != null ? ` · +${row.bonus}` : "";
  const range = row.rangeM != null ? ` · ${row.rangeM} m` : "";
  const ram = row.ram != null ? ` · RAM ${row.ram}` : "";
  const slots = row.slots != null ? ` · ${row.slots} slots` : "";
  if (cat === "firearm" || cat === "handgun" || cat === "smg") {
    return `${name}. Street iron${bonus}${range}.`;
  }
  if (cat === "melee") return `${name}. Close work${bonus}.`;
  if (cat === "armor" || cat === "armour") {
    return `${name}. Wear it when the street bites${bonus}.`;
  }
  if (cat === "heavy") return `${name}. Crew-served trouble${bonus}.`;
  if (cat === "ammo") return `${name}. Feed the gun.`;
  if (cat === "mod") return `${name}. Bolt it onto a host weapon.`;
  if (cat === "augmentation") return `${name}. Chrome you keep.`;
  if (cat === "shardware") return `${name}. Jack it if you have the port.`;
  if (cat === "console") return `${name}. Hull for the net${ram}${slots}.`;
  if (cat === "software") return `${name}. Load it into a free slot.`;
  if (cat === "net-hw") return `${name}. Nodejacker hardware.`;
  if (kind === "drug") return `${name}. A dose for the night.`;
  if (kind === "consumable") return `${name}. Use it and it's gone.`;
  return `${name}. Street kit. Keep it stowed.`;
}

function marketImage(row: Row): string {
  return String(row.image ?? row.media ?? row.img ?? row.art ?? "").trim();
}

function marketTags(row: Row): string[] {
  const tags: string[] = [];
  const category = String(row.category ?? "").trim();
  const kind = String(row.kind ?? "").trim();
  const book = String(row.book ?? "").trim();
  if (category) tags.push(category);
  if (kind && kind !== category) tags.push(kind);
  if (book) tags.push(book);
  if (Array.isArray(row.modes)) {
    for (const mode of row.modes) {
      const label = String(mode).trim();
      if (label) tags.push(label);
    }
  }
  return tags;
}

function marketStats(row: Row): Array<{ label: string; value: string }> {
  const stats: Array<{ label: string; value: string }> = [];
  if (row.bonus != null) stats.push({ label: "BONUS", value: `+${row.bonus}` });
  if (row.rangeM != null) stats.push({ label: "RANGE", value: `${row.rangeM} m` });
  if (row.load != null) stats.push({ label: "LOAD", value: String(row.load) });
  if (row.mag != null || row.magMax != null) {
    stats.push({
      label: "MAG",
      value: String(row.magMax ?? row.mag),
    });
  }
  if (row.ram != null) stats.push({ label: "RAM", value: String(row.ram) });
  if (row.slots != null) stats.push({ label: "SLOTS", value: String(row.slots) });
  if (row.firewall != null) stats.push({ label: "FW", value: String(row.firewall) });
  if (row.uses != null) {
    const unit = row.unit ? ` ${row.unit}` : "";
    stats.push({ label: "USES", value: `${row.uses}${unit}` });
  }
  return stats;
}

export function buildMarketPayload(
  cash: number,
  rows: Row[],
): MarketPayload {
  return {
    cash,
    items: rows.map((row) => ({
      slug: row.slug,
      name: String(row.name ?? row.slug),
      price: Number(row.cost ?? 0),
      spec: marketSpec(row),
      category: String(row.category ?? "general"),
      stock: "ok",
      image: marketImage(row),
      blurb: marketBlurb(row),
      kind: String(row.kind ?? row.category ?? ""),
      book: String(row.book ?? ""),
      tags: marketTags(row),
      stats: marketStats(row),
    })),
  };
}

export function emitMarketFrame(
  u: IUrsamuSDK,
  cash: number,
  text: string,
  rows: Row[] = marketStock(),
): void {
  emitSprawl(u, "market", buildMarketPayload(cash, rows), text);
}

export async function buildFlowPayload(): Promise<FlowPayload> {
  const rows = await districtCatalog();
  return {
    districts: rows.map((d) => ({
      slug: d.slug,
      name: d.name,
      grid: d.grid,
      blurb: d.blurb,
      open: d.open,
      ...(d.image ? { image: d.image } : {}),
      ...(d.roomId ? { roomId: d.roomId } : {}),
    })),
  };
}

export async function emitFlowFrame(
  u: IUrsamuSDK,
  text: string,
): Promise<void> {
  emitSprawl(u, "flow", await buildFlowPayload(), text);
}

export async function buildHauntPayload(): Promise<HauntPayload> {
  const rows = await hangoutCatalog();
  return {
    hangouts: rows.map((h) => ({
      slug: h.slug,
      name: h.name,
      kind: h.kind,
      blurb: h.blurb,
      open: h.open,
      ...(h.image ? { image: h.image } : {}),
      ...(h.roomId ? { roomId: h.roomId } : {}),
    })),
  };
}

export async function emitHauntFrame(
  u: IUrsamuSDK,
  text: string,
): Promise<void> {
  emitSprawl(u, "haunt", await buildHauntPayload(), text);
}

export async function emitSheetSideFrames(
  u: IUrsamuSDK,
  _target: IDBObj,
  c: ISprawlChar,
): Promise<void> {
  if (!u.clientType || u.clientType !== "web") return;
  await emitGearFrame(u, "GEAR");
  emitNetFrame(u, c, "NET");
  if (c.activeGig) emitGigFrame(u, c.activeGig, "GIG");
}
