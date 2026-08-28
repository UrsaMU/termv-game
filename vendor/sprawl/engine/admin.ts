/**
 * Staff admin payloads — catalogs, market stock, grant parse.
 */
import {
  ACCESSORIES,
  AFFECTATIONS,
  AMMO,
  ANTAGONISTS,
  ARMOR,
  AUGS,
  AUG_ORIGIN,
  BACKGROUNDS,
  BELONGINGS,
  CONSOLES,
  CONSOLE_UPGRADES,
  CORPS,
  DIFFICULTY,
  DRONES,
  EXPLOITS,
  FIREARMS,
  FLOW_DISTRICTS,
  FLOW_LOCATIONS,
  GIG_BOSSES,
  GIG_COMPLICATIONS,
  GIG_CONTRACTS,
  GIG_MINIONS,
  GIG_OBJECTIVES,
  GIG_ROOMS,
  GIG_SYSTEMS,
  GIG_TARGETS,
  GIG_VENUES,
  HACK_TARGETS,
  HEAVY,
  LEXICON,
  LOOK_OPENERS,
  MARKET,
  MELEE,
  NARCOTICS,
  NET_AI,
  NET_EXPLOITS,
  NODEJACKER_HW,
  PARADOXWARE,
  QUIRKS,
  SHOWROOM,
  SOFTWARE,
  STATS,
  STREET_TECH_QUIRKS,
  VEHICLE_MODS,
  VEHICLES,
  WEAPON_MODS,
  type Row,
} from "./catalog.ts";
import { marketStock } from "./market-stock.ts";

export const ADMIN_CATALOGS: Record<string, Row[]> = {
  stats: STATS,
  backgrounds: BACKGROUNDS,
  belongings: BELONGINGS,
  affectations: AFFECTATIONS,
  accessories: ACCESSORIES,
  quirks: QUIRKS,
  "street-tech-quirks": STREET_TECH_QUIRKS,
  firearms: FIREARMS,
  melee: MELEE,
  armor: ARMOR,
  heavy: HEAVY,
  ammo: AMMO,
  "weapon-mods": WEAPON_MODS,
  drones: DRONES,
  augs: AUGS,
  "aug-origin": AUG_ORIGIN,
  consoles: CONSOLES,
  "console-upgrades": CONSOLE_UPGRADES,
  exploits: EXPLOITS,
  "net-exploits": NET_EXPLOITS,
  "hack-targets": HACK_TARGETS,
  software: SOFTWARE,
  "net-ai": NET_AI,
  paradoxware: PARADOXWARE,
  "nodejacker-hw": NODEJACKER_HW,
  narcotics: NARCOTICS,
  vehicles: VEHICLES,
  "vehicle-mods": VEHICLE_MODS,
  showroom: SHOWROOM,
  antagonists: ANTAGONISTS,
  "flow-districts": FLOW_DISTRICTS,
  flow: FLOW_LOCATIONS,
  market: MARKET,
  corps: CORPS,
  difficulty: DIFFICULTY,
  lexicon: LEXICON,
  "look-openers": LOOK_OPENERS,
  "gig-rooms": GIG_ROOMS,
  "gig-contracts": GIG_CONTRACTS,
  "gig-venues": GIG_VENUES,
  "gig-objectives": GIG_OBJECTIVES,
  "gig-bosses": GIG_BOSSES,
  "gig-targets": GIG_TARGETS,
  "gig-complications": GIG_COMPLICATIONS,
  "gig-minions": GIG_MINIONS,
  "gig-systems": GIG_SYSTEMS,
};

export function adminCatalogKinds(): string[] {
  return Object.keys(ADMIN_CATALOGS).sort();
}

export function adminCatalog(kind: string): Row[] | null {
  const key = kind.trim().toLowerCase();
  if (!key || !(key in ADMIN_CATALOGS)) return null;
  return ADMIN_CATALOGS[key] ?? null;
}

export function adminOverview(): {
  system: string;
  catalogs: Array<{ kind: string; count: number }>;
  market: number;
} {
  return {
    system: "sprawl-goons",
    catalogs: adminCatalogKinds().map((kind) => ({
      kind,
      count: ADMIN_CATALOGS[kind]?.length ?? 0,
    })),
    market: marketStock().length,
  };
}

export function adminMarketCategories(): string[] {
  const set = new Set<string>();
  for (const r of marketStock()) {
    const c = String(r.category ?? "").trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function adminMarketRows(
  q = "",
  cat = "",
): Array<{
  slug: string;
  name: string;
  category: string;
  cost: number;
}> {
  const n = q.toLowerCase().trim();
  const c = cat.toLowerCase().trim();
  return marketStock()
    .filter((r) => {
      if (c && String(r.category ?? "").toLowerCase() !== c) {
        return false;
      }
      if (!n) return true;
      const blob =
        `${r.slug} ${r.name} ${r.category} ${r.notes ?? ""} ${r.blurb ?? ""}`
          .toLowerCase();
      return blob.includes(n);
    })
    .map((r) => ({
      slug: r.slug,
      name: String(r.name ?? r.slug),
      category: String(r.category ?? ""),
      cost: Number(r.cost ?? 0),
    }));
}

export function catalogRowPreview(row: Row): {
  slug: string;
  name: string;
  extra: string;
} {
  const name = String(row.name ?? row.slug);
  const extra = [
    row.ds != null ? `DS${row.ds}` : "",
    row.cost != null ? `${row.cost} b¥` : "",
    row.tier != null ? String(row.tier) : "",
    row.category != null ? String(row.category) : "",
    row.kind != null ? String(row.kind) : "",
    row.type != null ? String(row.type) : "",
  ].filter(Boolean).join(" · ");
  return { slug: String(row.slug ?? ""), name, extra };
}

/** Filter catalog rows by free-text query. */
export function filterCatalogRows(items: Row[], q: string): Row[] {
  const n = q.trim().toLowerCase();
  if (!n) return items;
  return items.filter((r) => {
    const prev = catalogRowPreview(r);
    const blob =
      `${prev.slug} ${prev.name} ${prev.extra} ${r.notes ?? ""} ${r.blurb ?? ""} ${r.effect ?? ""}`
        .toLowerCase();
    return blob.includes(n);
  });
}
