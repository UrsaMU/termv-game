/** Read/write state.sprawl on a player object. */
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import {
  defaultChar,
  type ISprawlChar,
  type SprawlItemData,
  readSprawl,
} from "../db/schemas.ts";
import {
  carriedItems,
  itemData,
  loadFromItems,
  migrateLoadoutToThings,
} from "./items.ts";

export function getChar(obj: IDBObj): ISprawlChar | null {
  const state = obj.state as Record<string, unknown> | undefined;
  const fromState = readSprawl(state);
  if (fromState) return fromState;
  const data = (obj as { data?: Record<string, unknown> }).data;
  return readSprawl(data) ??
    readSprawl(
      state?.data as Record<string, unknown> | undefined,
    );
}

export function requireChar(
  u: IUrsamuSDK,
  obj: IDBObj = u.me,
): ISprawlChar | null {
  const c = getChar(obj);
  if (!c || !c.chargenComplete) return null;
  return c;
}

export async function saveChar(
  u: IUrsamuSDK,
  char: ISprawlChar,
  targetId?: string,
): Promise<void> {
  const id = targetId ?? u.me.id;
  await u.db.modify(id, "$set", { "state.sprawl": char });
  const live = !targetId || targetId === u.me.id
    ? u.me
    : null;
  if (live) {
    live.state = { ...live.state, sprawl: char };
  }
}

/** Migrate legacy loadout[] then return carried Things + load. */
export async function getInventory(
  u: IUrsamuSDK,
  owner: IDBObj = u.me,
): Promise<{
  c: ISprawlChar | null;
  items: IDBObj[];
  data: SprawlItemData[];
  load: number;
}> {
  let c = getChar(owner);
  if (c && (c.loadout?.length ?? 0) > 0) {
    c = await migrateLoadoutToThings(u, owner, c);
    // Reflect on live object
    owner.state = { ...owner.state, sprawl: c };
  }
  const items = await carriedItems(u, owner.id);
  const data = items
    .map((o) => itemData(o))
    .filter((d): d is SprawlItemData => !!d);
  return { c, items, data, load: loadFromItems(data) };
}

export async function ensureDraft(
  u: IUrsamuSDK,
): Promise<ISprawlChar> {
  const existing = getChar(u.me);
  if (
    existing &&
    (existing.chargenStatus !== "none" || existing.chargenComplete)
  ) {
    return existing;
  }
  if (
    u.me.flags.has("approved") ||
    u.me.flags.has("APPROVED")
  ) {
    const locked = existing ?? defaultChar(
      String(u.me.name ?? u.me.state?.name ?? "Goon"),
    );
    return locked;
  }
  const draft = defaultChar(
    String(u.me.name ?? u.me.state?.name ?? "Goon"),
  );
  draft.chargenStatus = "draft";
  await saveChar(u, draft);
  return draft;
}

export function isStaff(u: IUrsamuSDK): boolean {
  return (
    u.me.flags.has("admin") ||
    u.me.flags.has("wizard") ||
    u.me.flags.has("superuser")
  );
}
