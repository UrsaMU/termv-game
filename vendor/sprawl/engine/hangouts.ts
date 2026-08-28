/**
 * Staff bindings for RP hangouts (bars, clinics, booths…).
 * Catalog: data/hangouts.json · DBO sprawl.hangouts
 */
import { DBO, dbojs } from "@ursamu/ursamu";
import hangoutsJson from "../data/hangouts.json" with { type: "json" };
import type { IUrsamuSDK } from "@ursamu/ursamu";
import {
  lookAfterJack,
  normPlaceUrl,
  resolveGameRoom,
  searchGameRooms,
  teleportToRoom,
} from "./places.ts";

export type HangoutDef = {
  slug: string;
  name: string;
  kind: string;
  blurb: string;
};

export type HangoutBind = {
  image?: string;
  roomId?: string;
  roomName?: string;
};

export type HangoutsDoc = {
  id: string;
  bySlug: Record<string, HangoutBind>;
  updatedAt?: number;
};

export type HangoutRow = {
  slug: string;
  name: string;
  kind: string;
  blurb: string;
  image: string | null;
  roomId: string | null;
  roomName: string | null;
  /** Player can jack in when a room is linked. */
  open: boolean;
};

export const HANGOUTS = hangoutsJson as HangoutDef[];

const COL = "sprawl.hangouts";
const DOC_ID = "default";
const store = new DBO<HangoutsDoc>(COL);

async function loadDoc(): Promise<HangoutsDoc> {
  const row = await store.queryOne({ id: DOC_ID });
  if (row && typeof row === "object") {
    const d = row as HangoutsDoc;
    return {
      id: DOC_ID,
      bySlug: { ...(d.bySlug ?? {}) },
      updatedAt: d.updatedAt,
    };
  }
  return { id: DOC_ID, bySlug: {} };
}

async function saveDoc(doc: HangoutsDoc): Promise<void> {
  const payload: HangoutsDoc = {
    id: DOC_ID,
    bySlug: doc.bySlug,
    updatedAt: Date.now(),
  };
  const existing = await store.queryOne({ id: DOC_ID });
  if (existing) await store.modify({ id: DOC_ID }, "$set", payload);
  else await store.create(payload);
}

function findDef(slug: string): HangoutDef | undefined {
  const key = slug.toLowerCase().trim();
  return HANGOUTS.find((h) => h.slug.toLowerCase() === key);
}

async function clearMark(roomId: string): Promise<void> {
  try {
    await dbojs.modify({ id: roomId }, "$unset", {
      "state.sprawl_hangout": true,
      "data.sprawl_hangout": true,
    });
  } catch {
    /* gone */
  }
}

async function applyMark(
  roomId: string,
  slug: string,
  image: string | undefined,
): Promise<void> {
  const patch: Record<string, unknown> = {
    "state.sprawl_hangout": slug,
    "data.sprawl_hangout": slug,
  };
  if (image) {
    patch["data.image"] = image;
    patch["data.image_url"] = image;
    patch["state.image"] = image;
  }
  await dbojs.modify({ id: roomId }, "$set", patch);
}

export async function hangoutCatalog(): Promise<HangoutRow[]> {
  const d = await loadDoc();
  return HANGOUTS.map((h) => {
    const b = d.bySlug[h.slug] ?? d.bySlug[h.slug.toLowerCase()] ?? {};
    const roomId = b.roomId?.trim() || null;
    return {
      slug: h.slug,
      name: h.name,
      kind: h.kind,
      blurb: h.blurb,
      image: b.image?.trim() ? b.image.trim() : null,
      roomId,
      roomName: b.roomName?.trim() || null,
      open: Boolean(roomId),
    };
  });
}

export async function getHangoutRow(
  slug: string,
): Promise<HangoutRow | null> {
  const rows = await hangoutCatalog();
  const key = slug.toLowerCase().trim();
  return rows.find((r) => r.slug.toLowerCase() === key) ?? null;
}

export async function setHangoutImage(
  slug: string,
  url: string,
): Promise<HangoutRow> {
  const def = findDef(slug);
  if (!def) throw new Error("Unknown hangout slug");
  const d = await loadDoc();
  const cur = { ...(d.bySlug[def.slug] ?? {}) };
  const image = normPlaceUrl(url);
  if (image) cur.image = image;
  else delete cur.image;
  if (!cur.image && !cur.roomId) delete d.bySlug[def.slug];
  else d.bySlug[def.slug] = cur;
  await saveDoc(d);
  if (cur.roomId && image) {
    try {
      await applyMark(cur.roomId, def.slug, image);
    } catch {
      /* */
    }
  }
  return (await getHangoutRow(def.slug))!;
}

export async function setHangoutRoom(
  slug: string,
  roomRef: string,
): Promise<HangoutRow> {
  const def = findDef(slug);
  if (!def) throw new Error("Unknown hangout slug");
  const d = await loadDoc();
  const cur = { ...(d.bySlug[def.slug] ?? {}) };
  const prevId = cur.roomId;
  const clear = !roomRef.trim() ||
    roomRef.trim().toLowerCase() === "clear";

  if (clear) {
    if (prevId) await clearMark(prevId);
    delete cur.roomId;
    delete cur.roomName;
  } else {
    const room = await resolveGameRoom(roomRef);
    if (!room) throw new Error("Room not found");
    for (const [s, b] of Object.entries(d.bySlug)) {
      if (s === def.slug) continue;
      if (b.roomId === room.id) {
        const next = { ...b };
        delete next.roomId;
        delete next.roomName;
        if (!next.image) delete d.bySlug[s];
        else d.bySlug[s] = next;
      }
    }
    if (prevId && prevId !== room.id) await clearMark(prevId);
    cur.roomId = room.id;
    cur.roomName = room.name;
    await applyMark(room.id, def.slug, cur.image);
  }

  if (!cur.image && !cur.roomId) delete d.bySlug[def.slug];
  else d.bySlug[def.slug] = cur;
  await saveDoc(d);
  return (await getHangoutRow(def.slug))!;
}

export { searchGameRooms as searchHangoutRooms };

/** Jack into a hangout — only if staff linked a room. */
export async function jackHangout(
  u: IUrsamuSDK,
  slug: string,
): Promise<{ ok: boolean; msg: string; row?: HangoutRow }> {
  const row = await getHangoutRow(slug);
  if (!row) {
    return {
      ok: false,
      msg: "Unknown haunt. +haunt for the board.",
    };
  }
  if (!row.roomId) {
    return {
      ok: false,
      msg:
        `${row.name} is dark — no floor cut yet. ` +
        `Staff has to link a room before you can slide in.`,
    };
  }
  const ok = await teleportToRoom(u, row.roomId);
  if (!ok) {
    return {
      ok: false,
      msg: `Couldn't slide into ${row.name}. Try again.`,
    };
  }
  await lookAfterJack(u);
  return {
    ok: true,
    msg: `Slid into ${row.name}` +
      (row.roomName ? ` · ${row.roomName}` : "") +
      `.`,
    row,
  };
}
