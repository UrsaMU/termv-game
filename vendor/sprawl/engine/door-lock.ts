/**
 * +lock thing=ds/12 — hackable lock overlay (not @lock).
 * Hack success unlocks until +lock again.
 */
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";

export type HackLock = {
  ds: number;
  locked: boolean;
};

type Attr = { name?: string; value?: string };

function bagOf(obj: IDBObj): Record<string, unknown> {
  const extra = (obj as { data?: Record<string, unknown> }).data;
  return {
    ...(extra ?? {}),
    ...((obj.state ?? {}) as Record<string, unknown>),
  };
}

export function parseDsLock(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const hit = t.match(/^ds\s*[/:]\s*(\d+)$/) ||
    t.match(/^ds\s*\(\s*(\d+)\s*\)$/);
  if (!hit) return null;
  const n = Number(hit[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(30, Math.floor(n));
}

export function hackLockOf(obj: IDBObj | null | undefined): HackLock | null {
  if (!obj) return null;
  const bag = bagOf(obj);
  const raw = bag.sprawl_lock as HackLock | undefined;
  if (raw && typeof raw === "object" && Number(raw.ds) >= 1) {
    return {
      ds: Math.min(30, Math.floor(Number(raw.ds))),
      locked: raw.locked !== false,
    };
  }
  const attrs = (bag.attributes as Attr[] | undefined) ?? [];
  const dsAttr = attrs.find((a) =>
    String(a.name ?? "").toLowerCase() === "ds"
  );
  const n = Number(dsAttr?.value ?? bag.ds);
  if (Number.isFinite(n) && n >= 1) {
    return { ds: Math.min(30, Math.floor(n)), locked: true };
  }
  return null;
}

export function isHackableLock(obj: IDBObj | null | undefined): boolean {
  return Boolean(hackLockOf(obj));
}

export function isLockSealed(obj: IDBObj | null | undefined): boolean {
  return Boolean(hackLockOf(obj)?.locked);
}

export function lockLabel(obj: IDBObj): string {
  const name = String(obj.name ?? "lock");
  return name.split(";")[0]?.trim() || name;
}

export function matchHackLock(
  objs: IDBObj[],
  q: string,
): IDBObj | null {
  const n = q.trim().toLowerCase().replace(/^#/, "");
  if (!n) return null;
  const list = objs.filter(isHackableLock);
  return (
    list.find((o) => o.id === n) ??
    list.find((o) =>
      String(o.name ?? "").toLowerCase().split(";").some((p) =>
        p.trim() === n
      )
    ) ??
    list.find((o) =>
      lockLabel(o).toLowerCase() === n ||
      lockLabel(o).toLowerCase().includes(n)
    ) ??
    null
  );
}

export async function loadRoomHackLocks(
  u: IUrsamuSDK,
  roomId?: string,
): Promise<IDBObj[]> {
  const id = roomId ?? u.here?.id ?? u.me.location;
  if (!id) {
    return ((u.here?.contents ?? []) as IDBObj[]).filter(isHackableLock);
  }
  const found = await u.db.search({ location: id });
  return (found as IDBObj[]).filter(isHackableLock);
}

export function setHackLock(ds: number, locked = true): HackLock {
  return {
    ds: Math.min(30, Math.max(1, Math.floor(ds))),
    locked,
  };
}

export async function writeHackLock(
  u: IUrsamuSDK,
  obj: IDBObj,
  next: HackLock,
): Promise<void> {
  if (obj.state) {
    (obj.state as Record<string, unknown>).sprawl_lock = next;
  }
  await u.db.modify(obj.id, "$set", { "data.sprawl_lock": next });
}

export async function tryHackLockAfterRoll(
  u: IUrsamuSDK,
  ref: string,
  success: boolean,
): Promise<{ notes: string[] }> {
  if (!success) return { notes: [] };
  const list = await loadRoomHackLocks(u);
  const obj = matchHackLock(list, ref);
  if (!obj) return { notes: [] };
  const lock = hackLockOf(obj);
  if (!lock) return { notes: [] };
  if (!lock.locked) {
    return { notes: [`${lockLabel(obj)} is already open.`] };
  }
  await writeHackLock(u, obj, { ds: lock.ds, locked: false });
  return {
    notes: [
      `${lockLabel(obj)} lock cracked (DS${lock.ds}) — open until +lock.`,
    ],
  };
}
