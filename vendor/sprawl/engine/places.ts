/**
 * Shared jack-in / room resolve for districts & hangouts.
 */
import type { IUrsamuSDK } from "@ursamu/ursamu";
import { dbojs } from "@ursamu/ursamu";

export function flagBlob(obj: { flags?: unknown }): string {
  const f = obj.flags;
  if (f instanceof Set) return [...f].map(String).join(" ");
  if (Array.isArray(f)) return f.map(String).join(" ");
  return String(f ?? "");
}

export function isRoomObj(obj: { flags?: unknown }): boolean {
  return /\broom\b/i.test(flagBlob(obj));
}

export function normPlaceUrl(raw: string): string | undefined {
  const u = raw.trim();
  if (!u || u.toLowerCase() === "clear" || u.toLowerCase() === "default") {
    return undefined;
  }
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) {
    throw new Error("URL must be http(s) or /path");
  }
  return u;
}

export async function resolveGameRoom(
  ref: string,
): Promise<{ id: string; name: string } | null> {
  const raw = ref.trim();
  if (!raw) return null;
  const id = raw.replace(/^#/, "");
  let obj = await dbojs.queryOne({ id });
  if (!obj) obj = await dbojs.queryOne({ name: raw });
  if (!obj) obj = await dbojs.queryOne({ "data.name": raw });
  if (!obj && raw.toLowerCase() !== raw) {
    obj = await dbojs.queryOne({ name: raw.toLowerCase() });
  }
  if (!obj) return null;
  const rec = obj as {
    id: string;
    name?: string;
    flags?: unknown;
    data?: { name?: string };
  };
  if (!isRoomObj(rec)) throw new Error("Target is not a room");
  const name = String(
    rec.name ?? rec.data?.name ?? rec.id,
  );
  return { id: String(rec.id), name };
}

export async function searchGameRooms(q = ""): Promise<
  Array<{ id: string; name: string }>
> {
  const needle = q.trim().toLowerCase();
  let rooms: Array<{ id: string; name?: string; flags?: unknown }> = [];
  try {
    rooms = await dbojs.query({ flags: /room/ }) as typeof rooms;
  } catch {
    rooms = [];
  }
  const hit = needle
    ? rooms.filter((r) => {
      const name = String(r.name ?? "").toLowerCase();
      const id = String(r.id).toLowerCase();
      return name.includes(needle) || id.includes(needle) ||
        `#${id}`.includes(needle);
    })
    : rooms;
  return hit
    .slice(0, 80)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function teleportToRoom(
  u: IUrsamuSDK,
  roomId: string,
): Promise<boolean> {
  const id = u.me?.id;
  if (!id || !roomId) return false;
  try {
    if (typeof u.teleport === "function") {
      await u.teleport(id, roomId);
    } else {
      await u.db.modify(id, "$set", { location: roomId });
    }
    return true;
  } catch {
    return false;
  }
}

/** After jack-in, nudge a look so the client scene updates. */
export async function lookAfterJack(u: IUrsamuSDK): Promise<void> {
  try {
    // Prefer the same path players use — many clients auto-look after move.
    const run = (u as { force?: (cmd: string) => Promise<void> }).force;
    if (typeof run === "function") {
      await run("look");
      return;
    }
  } catch {
    /* fall through */
  }
}
