/**
 * Gig site run: nodes, minions, boss spawn, hack complete.
 */
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import type { IActiveGig, ISprawlChar } from "../db/schemas.ts";
import {
  GIG_ROOMS,
  pickByRoll,
  rollD66,
  type Row,
} from "./catalog.ts";
import { spawnNpc } from "./npcs.ts";
import {
  dropGigToken,
  isGigBossNpc,
  isGigMinionNpc,
} from "./gigs.ts";
import { applyGigSiteLook } from "./gig-site.ts";
import { spawnGigSystems } from "./gig-systems.ts";
import { syncGigToCrew } from "./gig-party.ts";

function pickRoom(rng?: () => number): Row {
  return pickByRoll(GIG_ROOMS, rollD66(rng)) ??
    GIG_ROOMS[0];
}

async function tagNpc(
  u: IUrsamuSDK,
  obj: IDBObj,
  tag: Record<string, unknown>,
  desc: string,
): Promise<void> {
  const d = (obj.state as { sprawl_npc?: Record<string, unknown> })
    ?.sprawl_npc ?? {};
  const tagged = { ...d, ...tag };
  await u.db.modify(obj.id, "$set", {
    "data.sprawl_npc": tagged,
    "data.description": desc,
  });
  obj.state = { ...obj.state, sprawl_npc: tagged };
}

export function isBossNode(gig: IActiveGig): boolean {
  const max = gig.nodesMax ?? 1;
  const n = gig.node ?? 1;
  return n >= max;
}

/** Spawn minion pack for current node. */
export async function spawnGigMinions(
  u: IUrsamuSDK,
  c: ISprawlChar,
  gig: IActiveGig,
): Promise<{ ids: string[]; next: ISprawlChar; msg: string }> {
  const count = Math.max(1, gig.minionCount ?? 2);
  const ids: string[] = [...(gig.minionObjIds ?? [])];
  if (ids.length > 0) {
    return {
      ids,
      next: c,
      msg: "Minions already on-site.",
    };
  }
  const name = gig.minionName ?? "Goon";
  const slug = gig.minionSlug ?? "gang-member";
  const ds = gig.minionDs ?? 10;
  for (let i = 0; i < count; i++) {
    const label = count > 1 ? `${name} ${i + 1}` : name;
    const obj = await spawnNpc(u, {
      slug,
      name: label,
      ds,
    });
    if (!obj) continue;
    await tagNpc(u, obj, {
      gigMinion: true,
      gigId: gig.id,
      ownerId: u.me.id,
      name: label,
      slug,
    }, `${label} — gig hostile (DS${ds}).`);
    ids.push(obj.id);
  }
  const nextGig: IActiveGig = {
    ...gig,
    minionObjIds: ids,
    nodeCleared: ids.length === 0,
  };
  return {
    ids,
    next: { ...c, activeGig: nextGig },
    msg: ids.length
      ? `Spawned ${ids.length}× ${name} (DS${ds}).`
      : "Could not spawn minions.",
  };
}

/** Spawn principal on final node. */
export async function spawnGigBoss(
  u: IUrsamuSDK,
  c: ISprawlChar,
  gig: IActiveGig,
): Promise<{ obj: IDBObj | null; next: ISprawlChar }> {
  if (gig.bossObjId) {
    return { obj: null, next: c };
  }
  const obj = await spawnNpc(u, {
    slug: gig.bossSlug,
    name: gig.bossName,
    ds: gig.bossDs,
  });
  if (!obj) return { obj: null, next: c };
  await tagNpc(
    u,
    obj,
    {
      gigBoss: true,
      gigId: gig.id,
      ownerId: u.me.id,
      name: gig.bossName,
      slug: gig.bossSlug,
    },
    `${gig.bossName} — gig principal (DS${gig.bossDs}). ` +
      `Target: ${gig.targetName}.`,
  );
  return {
    obj,
    next: {
      ...c,
      activeGig: {
        ...gig,
        bossObjId: obj.id,
        status: "active",
      },
    },
  };
}

/**
 * Spawn hostiles for current node.
 * Pre-final: minion pack. Final flesh: boss.
 * Final hack-node: no flesh boss (systems handle objective).
 */
export async function spawnGigHostiles(
  u: IUrsamuSDK,
  c: ISprawlChar,
  gig: IActiveGig,
): Promise<{ next: ISprawlChar; msg: string }> {
  if (gig.tokenId || gig.status === "token") {
    return { next: c, msg: "Target already secured." };
  }
  if (isBossNode(gig)) {
    if (gig.objective === "hack-node") {
      // Light security flesh optional if none yet
      let next = c;
      const msgs: string[] = [];
      if (!(gig.minionObjIds ?? []).length) {
        const m = await spawnGigMinions(u, next, {
          ...gig,
          minionCount: Math.min(2, gig.minionCount ?? 2),
        });
        next = m.next;
        if (m.ids.length) {
          msgs.push(m.msg);
        }
      }
      msgs.push(
        `Net objective — +hack the PRIMARY system` +
          ` (DS${gig.hackDs ?? 12}` +
          (gig.hackTargetName
            ? ` · ${gig.hackTargetName}`
            : "") +
          `). Flesh is optional noise.`,
      );
      return { next, msg: msgs.join(" ") };
    }
    if (gig.bossObjId) {
      return {
        next: c,
        msg: `Boss already up (#${gig.bossObjId}).`,
      };
    }
    const { obj, next } = await spawnGigBoss(u, c, gig);
    if (!obj) {
      return { next: c, msg: "Could not spawn boss (no room?)." };
    }
    return {
      next,
      msg:
        `Principal ${gig.bossName} DS${gig.bossDs} is here.`,
    };
  }
  const r = await spawnGigMinions(u, c, gig);
  return { next: r.next, msg: r.msg };
}

/**
 * Auto-fill node: hostiles + hackable systems.
 * Called on enter and after push.
 */
export async function populateGigNode(
  u: IUrsamuSDK,
  c: ISprawlChar,
  gig: IActiveGig,
): Promise<{ next: ISprawlChar; msgs: string[] }> {
  const msgs: string[] = [];
  let next = c;
  let g = gig;

  if (g.tokenId || g.status === "token") {
    return { next, msgs };
  }

  const host = await spawnGigHostiles(u, next, g);
  next = host.next;
  g = next.activeGig ?? g;
  if (host.msg) msgs.push(host.msg);

  const sys = await spawnGigSystems(u, next, g);
  next = sys.next;
  if (sys.msgs.length) {
    msgs.push("Systems: " + sys.msgs.join(" · "));
  }

  // Hack-node final: node not clear until primary hacked
  if (
    isBossNode(g) &&
    g.objective === "hack-node" &&
    !g.primaryHacked
  ) {
    const ng = {
      ...(next.activeGig ?? g),
      nodeCleared: false,
    };
    next = { ...next, activeGig: ng };
  }

  return { next, msgs };
}

/** Advance to next node after clear (new room blurb). */
export function pushGigNode(
  gig: IActiveGig,
  rng?: () => number,
): { gig: IActiveGig; msg: string } {
  const max = gig.nodesMax ?? 1;
  const cur = gig.node ?? 1;
  if (cur >= max) {
    return {
      gig,
      msg: "Already on the final node.",
    };
  }
  if (!gig.nodeCleared && (gig.minionObjIds ?? []).length > 0) {
    return {
      gig,
      msg: "Clear hostiles first (+attack).",
    };
  }
  const nextNode = cur + 1;
  const room = pickRoom(rng);
  const next: IActiveGig = {
    ...gig,
    node: nextNode,
    roomSlug: String(room.slug),
    roomName: String(room.name ?? room.slug),
    roomBlurb: room.blurb ? String(room.blurb) : undefined,
    roomDesc: room.description
      ? String(room.description)
      : room.blurb
      ? String(room.blurb)
      : undefined,
    nodeCleared: false,
    minionObjIds: [],
  };
  const final = nextNode >= max;
  return {
    gig: next,
    msg: final
      ? `Node ${nextNode}/${max} — FINAL. ` +
        `${next.roomName}. ` +
        (gig.objective === "hack-node"
          ? `+hack PRIMARY (DS${gig.hackDs ?? 12})`
          : `hostiles auto-spawn`) +
        `. look`
      : `Node ${nextNode}/${max} — ${next.roomName}. ` +
        `Hostiles + systems auto-spawn. look`,
  };
}

/** Push node, refresh look, auto-populate hostiles/systems. */
export async function pushGigNodeAndLook(
  u: IUrsamuSDK,
  c: ISprawlChar,
  gig: IActiveGig,
  rng?: () => number,
): Promise<{ next: ISprawlChar; msg: string; msgs: string[] }> {
  const r = pushGigNode(gig, rng);
  if (r.gig.node === gig.node) {
    return { next: c, msg: r.msg, msgs: [] };
  }
  if (r.gig.siteRoomId) {
    await applyGigSiteLook(u, r.gig.siteRoomId, r.gig);
  }
  // Clear old system ids — new node gets fresh props
  const cleared: IActiveGig = {
    ...r.gig,
    systemObjIds: [],
    primarySystemId: undefined,
  };
  // Destroy leftover systems from prior node in room
  if (gig.systemObjIds?.length) {
    for (const id of gig.systemObjIds) {
      try {
        await u.db.destroy(id);
      } catch {
        /* ok */
      }
    }
  }
  const pop = await populateGigNode(u, {
    ...c,
    activeGig: cleared,
  }, cleared);
  return {
    next: pop.next,
    msg: r.msg,
    msgs: pop.msgs,
  };
}

/** Mark minion dead; clear node when pack empty. */
export function onGigMinionKilled(
  c: ISprawlChar,
  objId: string,
): { next: ISprawlChar; cleared: boolean } {
  const gig = c.activeGig;
  if (!gig) return { next: c, cleared: false };
  const left = (gig.minionObjIds ?? []).filter((id) =>
    id !== objId
  );
  const cleared = left.length === 0;
  const nextGig: IActiveGig = {
    ...gig,
    minionObjIds: left,
    nodeCleared: cleared || gig.nodeCleared,
  };
  return {
    next: { ...c, activeGig: nextGig },
    cleared,
  };
}

/** Successful hack against gig DS drops token (hack-node). */
export async function tryGigHackComplete(
  u: IUrsamuSDK,
  c: ISprawlChar,
  dsUsed: number,
): Promise<{
  next: ISprawlChar;
  note: string | null;
}> {
  const gig = c.activeGig;
  if (!gig || gig.objective !== "hack-node") {
    return { next: c, note: null };
  }
  if (gig.tokenId || gig.status === "token") {
    return { next: c, note: null };
  }
  const need = gig.hackDs ?? 12;
  // Must beat at least the contract DS (higher OK)
  if (dsUsed < need) {
    return { next: c, note: null };
  }
  // Prefer final node; allow earlier if they hit the DS
  const dropped = await dropGigToken(u, c, gig);
  if (!dropped.token) {
    return { next: c, note: null };
  }
  return {
    next: dropped.next,
    note: `GIG TARGET ${gig.targetName} cracked (+gig/turnin)`,
  };
}

/** Destroy spawned gig NPCs + systems (abandon). */
export async function destroyGigHostiles(
  u: IUrsamuSDK,
  gig: IActiveGig,
): Promise<void> {
  const ids = [
    ...(gig.minionObjIds ?? []),
    ...(gig.bossObjId ? [gig.bossObjId] : []),
    ...(gig.systemObjIds ?? []),
    ...(gig.primarySystemId ? [gig.primarySystemId] : []),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      await u.db.destroy(id);
    } catch {
      /* ok */
    }
  }
}

export function isGigDeeperExit(exitName: string): boolean {
  const name = exitName.split(";")[0]?.trim().toLowerCase() ?? "";
  return name === "deeper" || name === "in" || name === "forward" ||
    name === "next";
}

/** Only scripted autoPlot nodes move the crew. Else the player takes an exit. */
export function shouldAutoAdvance(gig: IActiveGig): boolean {
  if (gig.autoPlot !== true) return false;
  if (gig.tokenId || gig.status === "token") return false;
  if (isBossNode(gig)) return false;
  return nodeReadyToAdvance(gig).ok;
}

export function gigExitAdvance(
  gig: IActiveGig,
  exitName: string,
): { advance: boolean; reason?: string } {
  if (!isGigDeeperExit(exitName)) return { advance: false };
  if (isBossNode(gig) || gig.tokenId || gig.status === "token") {
    return { advance: false, reason: "Final node — +gig/turnin" };
  }
  const gate = nodeReadyToAdvance(gig);
  if (!gate.ok) return { advance: false, reason: gate.reason };
  return { advance: true };
}

/**
 * After the last hostile drops, walk the crew into the next room
 * only when autoPlot is set.
 */
export async function maybeAutoAdvanceGig(
  u: IUrsamuSDK,
  c: ISprawlChar,
): Promise<{ next: ISprawlChar; note: string | null; pushed: boolean }> {
  const gig = c.activeGig;
  if (!gig) return { next: c, note: null, pushed: false };
  if (gig.tokenId || gig.status === "token") {
    return {
      next: c,
      note: `TARGET ${gig.targetName} — +gig/turnin`,
      pushed: false,
    };
  }
  if (!shouldAutoAdvance(gig)) {
    return { next: c, note: null, pushed: false };
  }
  const r = await pushGigNodeAndLook(u, c, gig);
  const ng = r.next.activeGig;
  if (!ng || ng.node === gig.node) {
    return { next: c, note: r.msg, pushed: false };
  }
  await syncGigToCrew(u, r.next);
  const room = ng.roomName || "next room";
  return {
    next: r.next,
    note:
      `NODE CLEAR — site moves. ${room} (${ng.node}/${ng.nodesMax}).`,
    pushed: true,
  };
}

/** Boss drop or last minion → auto-advance. */
export async function onGigHostileDown(
  u: IUrsamuSDK,
  sheet: ISprawlChar,
  npcObj: IDBObj,
): Promise<{ next: ISprawlChar; note: string | null }> {
  const gig = sheet.activeGig;
  if (!gig) return { next: sheet, note: null };
  if (isGigBossNpc(npcObj, gig, u.me.id)) {
    const dropped = await dropGigToken(u, sheet, gig);
    if (!dropped.token) return { next: sheet, note: null };
    return {
      next: dropped.next,
      note: `TARGET ${gig.targetName} — +gig/turnin`,
    };
  }
  if (!isGigMinionNpc(npcObj, gig, u.me.id)) {
    return { next: sheet, note: null };
  }
  const mk = onGigMinionKilled(sheet, npcObj.id);
  if (!mk.cleared) return { next: mk.next, note: null };
  const auto = await maybeAutoAdvanceGig(u, mk.next);
  if (auto.pushed) return { next: auto.next, note: auto.note };
  const g = auto.next.activeGig;
  if (g?.tokenId) {
    return {
      next: auto.next,
      note: gigNextHint(g),
    };
  }
  // Refresh site look so room status flips to GO DEEPER.
  if (g?.siteRoomId) {
    try {
      await applyGigSiteLook(u, g.siteRoomId, g);
    } catch {
      /* ok */
    }
  }
  return {
    next: auto.next,
    note: g ? gigNextHint(g) : "NODE CLEAR — GO DEEPER (+gig/push)",
  };
}

export function nodeReadyToAdvance(gig: IActiveGig): {
  ok: boolean;
  reason?: string;
} {
  if (gig.tokenId || gig.status === "token") {
    return { ok: true };
  }
  if (isBossNode(gig) && gig.objective === "hack-node") {
    if (gig.primaryHacked || gig.tokenId) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        `Crack the PRIMARY system ` +
        `(+hack DS${gig.hackDs ?? 12}` +
        (gig.hackTargetName
          ? ` · ${gig.hackTargetName}`
          : "") +
        `).`,
    };
  }
  if ((gig.minionObjIds ?? []).length > 0) {
    return {
      ok: false,
      reason: `${gig.minionObjIds!.length} hostiles still up.`,
    };
  }
  if (!gig.nodeCleared) {
    return {
      ok: false,
      reason: "Clear hostiles first (they auto-spawn).",
    };
  }
  return { ok: true };
}

/** Mid-run: player can +gig/push / take Deeper (not final, not token). */
export function gigCanAdvance(gig: IActiveGig): boolean {
  if (gig.tokenId || gig.status === "token") return false;
  if (isBossNode(gig)) return false;
  return nodeReadyToAdvance(gig).ok;
}

/** Short next-step line for frames, desk, and room status. */
export function gigNextHint(gig: IActiveGig): string {
  if (gig.tokenId || gig.status === "token") {
    return `TARGET SECURED — +gig/turnin`;
  }
  if (isBossNode(gig)) {
    if (gig.objective === "hack-node" && !gig.primaryHacked && !gig.tokenId) {
      return `FINAL — +hack PRIMARY (DS${gig.hackDs ?? 12})` +
        (gig.hackTargetName ? ` · ${gig.hackTargetName}` : "");
    }
    if (gig.objective !== "hack-node" && !gig.tokenId) {
      return `FINAL — put down ${gig.bossName ?? "the principal"}` +
        ` (DS${gig.bossDs ?? "?"})`;
    }
    return `FINAL — +gig/turnin`;
  }
  if (gigCanAdvance(gig)) {
    return `NODE CLEAR — GO DEEPER (+gig/push)`;
  }
  if ((gig.minionObjIds ?? []).length > 0) {
    return `CLEAR ROOM — +attack · +hack`;
  }
  return `Clear this node, then GO DEEPER.`;
}
