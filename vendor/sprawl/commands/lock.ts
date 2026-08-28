/** +lock / +unlock — hackable DS locks (does not touch @lock). */
import { addCmd } from "@ursamu/ursamu";
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import {
  ARR,
  ERR,
  OK,
  dim,
  val,
} from "./chrome.ts";
import {
  hackLockOf,
  isHackableLock,
  lockLabel,
  parseDsLock,
  setHackLock,
  writeHackLock,
} from "../engine/door-lock.ts";

function splitLockArg(raw: string): { target: string; key: string } {
  const cut = raw.indexOf("=");
  if (cut < 0) return { target: raw.trim(), key: "" };
  return {
    target: raw.slice(0, cut).trim(),
    key: raw.slice(cut + 1).trim(),
  };
}

addCmd({
  name: "+lock",
  pattern: /^\+lock(?:\/(\S+))?\s*(.*)/i,
  lock: "connected",
  category: "Sprawl Goons",
  help: `+lock <thing>=ds/<n>  — Set a hackable lock (not @lock).
+lock <thing>           — Relock an existing DS lock.

Examples:
  +lock north=ds/12
  +lock panel=ds/8
  +lock north`,

  exec: async (u: IUrsamuSDK) => {
    const raw = u.util.stripSubs(u.cmd.args[1] ?? "").trim();
    if (!raw) {
      u.send(`${ERR}Usage: ${val("+lock <thing>=ds/12")}`);
      return;
    }
    const { target, key } = splitLockArg(raw);
    if (!target) {
      u.send(`${ERR}Usage: ${val("+lock <thing>=ds/12")}`);
      return;
    }
    const tar = await u.util.target(u.me, target);
    if (!tar) {
      u.send(`${ERR}I can't find that to lock.`);
      return;
    }
    const existing = hackLockOf(tar);
    let ds = existing?.ds ?? 0;
    if (key) {
      const parsed = parseDsLock(key);
      if (parsed == null) {
        u.send(`${ERR}Use ${val("ds/12")} — this is not @lock.`);
        return;
      }
      ds = parsed;
      if (!(await u.canEdit(u.me, tar))) {
        u.send(`${ERR}Permission denied.`);
        return;
      }
    } else if (!existing) {
      u.send(`${ERR}No DS lock on that. ${val("+lock <thing>=ds/12")}`);
      return;
    }
    const next = setHackLock(ds, true);
    await writeHackLock(u, tar as IDBObj, next);
    u.send(
      `${OK}Locked ${val(lockLabel(tar as IDBObj))} ` +
        `${dim("DS" + next.ds)} · +hack to crack.`,
    );
  },
});

addCmd({
  name: "+unlock",
  pattern: /^\+unlock\s+(.*)/i,
  lock: "connected builder+",
  category: "Sprawl Goons",
  help: `+unlock <thing>  — Staff-clear a hackable DS lock overlay.

Does not touch @lock. Players crack locks with +hack.`,

  exec: async (u: IUrsamuSDK) => {
    const raw = u.util.stripSubs(u.cmd.args[0] ?? "").trim();
    if (!raw) {
      u.send(`${ERR}Usage: ${val("+unlock <thing>")}`);
      return;
    }
    const tar = await u.util.target(u.me, raw);
    if (!tar) {
      u.send(`${ERR}I can't find that.`);
      return;
    }
    if (!isHackableLock(tar as IDBObj)) {
      u.send(`${ARR}No DS lock on that.`);
      return;
    }
    if (!(await u.canEdit(u.me, tar))) {
      u.send(`${ERR}Permission denied.`);
      return;
    }
    const lock = hackLockOf(tar as IDBObj)!;
    await writeHackLock(u, tar as IDBObj, { ds: lock.ds, locked: false });
    u.send(`${OK}Unlocked ${val(lockLabel(tar as IDBObj))}.`);
  },
});
