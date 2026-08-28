/**
 * Staff bindings for Flow districts: linked game room + client art.
 * Stored in DBO sprawl.districts.
 */
import { DBO, dbojs } from "@ursamu/ursamu";
import type { IUrsamuSDK } from "@ursamu/ursamu";
import { FLOW_DISTRICTS } from "./catalog.ts";
import {
  lookAfterJack,
  normPlaceUrl,
  resolveGameRoom,
  searchGameRooms,
  teleportToRoom,
} from "./places.ts";

export type DistrictBind = {
  image?: string;
  roomId?: string;
  roomName?: string;
};

export type DistrictsDoc = {
  id: string;
  bySlug: Record<string, DistrictBind>;
  updatedAt?: number;
};

export type DistrictRow = {
  slug: string;
  name: string;
  grid: string;
  blurb: string;
  image: string | null;
  roomId: string | null;
  roomName: string | null;
  /** True when a game room is linked — players can jack in. */
  open: boolean;
};

const COL = "sprawl.districts";
const DOC_ID = "default";
const store = new DBO<DistrictsDoc>(COL);

async function loadDoc(): Promise<DistrictsDoc> {
  const row = await store.queryOne({ id: DOC_ID });
  if (row && typeof row === "object") {
    const d = row as DistrictsDoc;
    return {
      id: DOC_ID,
      bySlug: { ...(d.bySlug ?? {}) },
      updatedAt: d.updatedAt,
    };
  }
  return { id: DOC_ID, bySlug: {} };
}

async function saveDoc(doc: DistrictsDoc): Promise<void> {
  const payload: DistrictsDoc = {
    id: DOC_ID,
    bySlug: doc.bySlug,
    updatedAt: Date.now(),
  };
  const existing = await store.queryOne({ id: DOC_ID });
  if (existing) {
    await store.modify({ id: DOC_ID }, "$set", payload);
  } else {
    await store.create(payload);
  }
}

export async function listDistrictBinds(): Promise<
  Record<string, DistrictBind>
> {
  const d = await loadDoc();
  return { ...d.bySlug };
}

export async function getDistrictBind(
  slug: string,
): Promise<DistrictBind | null> {
  const key = slug.toLowerCase().trim();
  if (!key) return null;
  const d = await loadDoc();
  return d.bySlug[key] ?? null;
}

export async function districtCatalog(): Promise<DistrictRow[]> {
  const binds = await listDistrictBinds();
  return FLOW_DISTRICTS.map((r) => {
    const slug = String(r.slug);
    const b = binds[slug] ?? binds[slug.toLowerCase()] ?? {};
    const roomId = b.roomId?.trim() ? b.roomId.trim() : null;
    return {
      slug,
      name: String(r.name ?? r.slug),
      grid: String(r.grid ?? ""),
      blurb: String(r.blurb ?? ""),
      image: b.image?.trim() ? b.image.trim() : null,
      roomId,
      roomName: b.roomName?.trim() ? b.roomName.trim() : null,
      open: Boolean(roomId),
    };
  });
}

export async function getDistrictRow(
  slug: string,
): Promise<DistrictRow | null> {
  const key = slug.toLowerCase().trim();
  const rows = await districtCatalog();
  return rows.find((r) => r.slug.toLowerCase() === key) ?? null;
}

/** Jack the player into a district room — only if staff linked one. */
export async function jackDistrict(
  u: IUrsamuSDK,
  slug: string,
): Promise<{ ok: boolean; msg: string; row?: DistrictRow }> {
  const row = await getDistrictRow(slug);
  if (!row) {
    return {
      ok: false,
      msg: "Unknown sector. +flow districts for the atlas.",
    };
  }
  if (!row.roomId) {
    return {
      ok: false,
      msg:
        `${row.name} has no hardline yet — no room on the grid. ` +
        `Staff has to cut a room before you can jack in.`,
    };
  }
  const ok = await teleportToRoom(u, row.roomId);
  if (!ok) {
    return {
      ok: false,
      msg: `Hardline to ${row.name} failed. Try again.`,
    };
  }
  await lookAfterJack(u);
  return {
    ok: true,
    msg: `Jacked into ${row.name}` +
      (row.roomName ? ` · ${row.roomName}` : "") +
      `.`,
    row,
  };
}

async function clearRoomDistrictMark(roomId: string): Promise<void> {
  try {
    await dbojs.modify({ id: roomId }, "$unset", {
      "state.sprawl_district": true,
      "data.sprawl_district": true,
    });
  } catch {
    /* room may be gone */
  }
}

async function applyRoomDistrictMark(
  roomId: string,
  slug: string,
  image: string | undefined,
): Promise<void> {
  const patch: Record<string, unknown> = {
    "state.sprawl_district": slug,
    "data.sprawl_district": slug,
  };
  if (image) {
    patch["data.image"] = image;
    patch["data.image_url"] = image;
    patch["state.image"] = image;
  }
  await dbojs.modify({ id: roomId }, "$set", patch);
}

/** Set or clear the client image for a district slug. */
export async function setDistrictImage(
  slug: string,
  url: string,
): Promise<DistrictRow> {
  const key = slug.toLowerCase().trim();
  const canon = FLOW_DISTRICTS.find(
    (d) => String(d.slug).toLowerCase() === key,
  );
  if (!canon) throw new Error("Unknown district slug");
  const canonSlug = String(canon.slug);
  const d = await loadDoc();
  const cur = { ...(d.bySlug[canonSlug] ?? d.bySlug[key] ?? {}) };
  const image = normPlaceUrl(url);
  if (image) cur.image = image;
  else delete cur.image;
  if (!cur.image && !cur.roomId) {
    delete d.bySlug[canonSlug];
    delete d.bySlug[key];
  } else {
    d.bySlug[canonSlug] = cur;
    if (key !== canonSlug) delete d.bySlug[key];
  }
  await saveDoc(d);
  if (cur.roomId && image) {
    try {
      await applyRoomDistrictMark(cur.roomId, canonSlug, image);
    } catch {
      /* room may be gone */
    }
  }
  const rows = await districtCatalog();
  return rows.find((r) => r.slug === canonSlug)!;
}

/**
 * Bind a game room to a district (or clear).
 * `roomRef` is room id (#n) or name; "clear" unbinds.
 */
export async function setDistrictRoom(
  slug: string,
  roomRef: string,
): Promise<DistrictRow> {
  const key = slug.toLowerCase().trim();
  const canon = FLOW_DISTRICTS.find(
    (d) => String(d.slug).toLowerCase() === key,
  );
  if (!canon) throw new Error("Unknown district slug");
  const canonSlug = String(canon.slug);
  const d = await loadDoc();
  const cur = { ...(d.bySlug[canonSlug] ?? {}) };

  const prevId = cur.roomId;
  const clear = !roomRef.trim() ||
    roomRef.trim().toLowerCase() === "clear";

  if (clear) {
    if (prevId) await clearRoomDistrictMark(prevId);
    delete cur.roomId;
    delete cur.roomName;
  } else {
    const room = await resolveGameRoom(roomRef);
    if (!room) throw new Error("Room not found");
    // Drop this room from any other district
    for (const [s, b] of Object.entries(d.bySlug)) {
      if (s === canonSlug) continue;
      if (b.roomId === room.id) {
        const next = { ...b };
        delete next.roomId;
        delete next.roomName;
        if (!next.image) delete d.bySlug[s];
        else d.bySlug[s] = next;
      }
    }
    if (prevId && prevId !== room.id) {
      await clearRoomDistrictMark(prevId);
    }
    cur.roomId = room.id;
    cur.roomName = room.name;
    await applyRoomDistrictMark(room.id, canonSlug, cur.image);
  }

  if (!cur.image && !cur.roomId) {
    delete d.bySlug[canonSlug];
  } else {
    d.bySlug[canonSlug] = cur;
  }
  await saveDoc(d);
  const rows = await districtCatalog();
  return rows.find((r) => r.slug === canonSlug)!;
}

/** Search rooms for the admin picker. */
export async function searchRooms(q = ""): Promise<
  Array<{ id: string; name: string }>
> {
  return searchGameRooms(q);
}


