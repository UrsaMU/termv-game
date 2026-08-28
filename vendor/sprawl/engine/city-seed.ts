/**
 * Starter Flow seed — a few OPEN districts + haunts so the city
 * loop works out of the box. Idempotent on engine:ready.
 */
import { dbojs } from "@ursamu/ursamu";
import { setDistrictRoom } from "./districts.ts";
import { setHangoutRoom } from "./hangouts.ts";

export type SeedPlace = {
  kind: "district" | "haunt";
  slug: string;
  /** Room name in the world. */
  roomName: string;
  /** Short look prose (1–2 sentences). */
  description: string;
};

/** Curated starter set — keep small and playable. */
export const STARTER_CITY: SeedPlace[] = [
  {
    kind: "district",
    slug: "halogen-heights",
    roomName: "Halogen Heights — Floodlight Strip",
    description:
      "Broken habitation under white floodlights. " +
      "Wet asphalt, warehouse gates, and the east streets half-drowned.",
  },
  {
    kind: "district",
    slug: "filter-valley",
    roomName: "Filter Valley — Shard Row",
    description:
      "Smart-condos and clinic neon. " +
      "Shardstores, aug bays, and VRcades hum behind rain-slick glass.",
  },
  {
    kind: "district",
    slug: "nightside",
    roomName: "Nightside — Neon Canyon",
    description:
      "Always in the shadow of the Heights. " +
      "Vivid holography, deep alleys, and eyes that never clock out.",
  },
  {
    kind: "haunt",
    slug: "static-lounge",
    roomName: "The Static Lounge",
    description:
      "Synth-whiskey and dead channels on every wall. " +
      "Booths deep enough for a deal — or a body.",
  },
  {
    kind: "haunt",
    slug: "chrome-iodine",
    roomName: "Chrome & Iodine",
    description:
      "Walk-in meat repairs. Cash on the tray, no questions, " +
      "lazarus wrappers in the bin.",
  },
  {
    kind: "haunt",
    slug: "noodle-noir",
    roomName: "Noodle Noir",
    description:
      "Steam, broth, and plastic stools. " +
      "The back booth is always reserved for people who don't want names.",
  },
];

const SEED_KEY = "sprawl_city_seed";

function flagBlob(obj: { flags?: unknown }): string {
  const f = obj.flags;
  if (f instanceof Set) return [...f].map(String).join(" ");
  if (Array.isArray(f)) return f.map(String).join(" ");
  return String(f ?? "");
}

async function findSeedRoom(place: SeedPlace): Promise<{
  id: string;
  name: string;
} | null> {
  const byDataName = await dbojs.queryOne({
    "data.name": place.roomName,
  });
  if (byDataName) {
    return {
      id: String((byDataName as { id: string }).id),
      name: place.roomName,
    };
  }
  const byName = await dbojs.queryOne({ name: place.roomName });
  if (byName) {
    return {
      id: String((byName as { id: string }).id),
      name: place.roomName,
    };
  }
  // Fallback: mark on state/data
  try {
    const rooms = await dbojs.query({ flags: /room/i }) as Array<{
      id: string;
      name?: string;
      state?: Record<string, unknown>;
      data?: Record<string, unknown>;
    }>;
    const mark = `${place.kind}:${place.slug}`;
    for (const r of rooms) {
      const st = r.state ?? {};
      const data = r.data ?? {};
      if (st[SEED_KEY] === mark || data[SEED_KEY] === mark) {
        return {
          id: String(r.id),
          name: String(r.name ?? data.name ?? r.id),
        };
      }
    }
  } catch {
    /* ok */
  }
  return null;
}

async function ensureRoom(place: SeedPlace): Promise<{
  id: string;
  name: string;
  created: boolean;
}> {
  const existing = await findSeedRoom(place);
  if (existing) {
    // Keep desc/mark fresh
    try {
      await dbojs.modify({ id: existing.id }, "$set", {
        "data.description": place.description,
        "state.description": place.description,
        [`data.${SEED_KEY}`]: `${place.kind}:${place.slug}`,
        [`state.${SEED_KEY}`]: `${place.kind}:${place.slug}`,
        "data.name": place.roomName,
      });
    } catch {
      /* ok */
    }
    return { ...existing, created: false };
  }

  const mark = `${place.kind}:${place.slug}`;
  // Engine KV rooms use string flags + data.name (see builder / mush tests).
  const created = await dbojs.create({
    id: crypto.randomUUID(),
    flags: "room",
    data: {
      name: place.roomName,
      description: place.description,
      [SEED_KEY]: mark,
    },
  } as never);

  if (!created || !(created as { id?: string }).id) {
    throw new Error(`Could not create room for ${place.slug}`);
  }
  const id = String((created as { id: string }).id);
  // Mirror description onto common look paths
  try {
    await dbojs.modify({ id }, "$set", {
      "data.description": place.description,
      "state.description": place.description,
      [`state.${SEED_KEY}`]: mark,
    });
  } catch {
    /* ok */
  }
  return { id, name: place.roomName, created: true };
}

export type CitySeedReport = {
  ok: boolean;
  created: string[];
  linked: string[];
  skipped: string[];
  errors: string[];
};

/** Ensure starter districts + haunts exist and are OPEN. */
export async function seedStarterCity(): Promise<CitySeedReport> {
  const report: CitySeedReport = {
    ok: true,
    created: [],
    linked: [],
    skipped: [],
    errors: [],
  };

  for (const place of STARTER_CITY) {
    try {
      const room = await ensureRoom(place);
      if (room.created) report.created.push(place.slug);
      if (place.kind === "district") {
        const row = await setDistrictRoom(place.slug, room.id);
        if (row.open) report.linked.push(`district:${place.slug}`);
        else report.skipped.push(`district:${place.slug}`);
      } else {
        const row = await setHangoutRoom(place.slug, room.id);
        if (row.open) report.linked.push(`haunt:${place.slug}`);
        else report.skipped.push(`haunt:${place.slug}`);
      }
    } catch (e: unknown) {
      report.ok = false;
      report.errors.push(
        `${place.slug}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return report;
}

/** Format report for staff console. */
export function formatSeedReport(r: CitySeedReport): string[] {
  const lines = [
    `City seed: ${r.ok ? "ok" : "partial"}`,
    `  created rooms: ${r.created.length ? r.created.join(", ") : "—"}`,
    `  linked OPEN: ${r.linked.length ? r.linked.join(", ") : "—"}`,
  ];
  if (r.skipped.length) {
    lines.push(`  skipped: ${r.skipped.join(", ")}`);
  }
  if (r.errors.length) {
    lines.push(`  errors: ${r.errors.join(" · ")}`);
  }
  return lines;
}

/** True if a room looks like a normal world room (sanity). */
export function isProbablyRoom(obj: { flags?: unknown }): boolean {
  return /\broom\b/i.test(flagBlob(obj));
}
