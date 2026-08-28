/** +haunt — RP hangouts / dives / booths. Jack in only when room linked. */
import { addCmd } from "@ursamu/ursamu";
import type { IUrsamuSDK } from "@ursamu/ursamu";
import {
  footer,
  ERR,
  OK,
  header,
  dim,
  val,
  wrap,
  ylw,
} from "./chrome.ts";
import {
  hangoutCatalog,
  jackHangout,
} from "../engine/hangouts.ts";

addCmd({
  name: "+haunt",
  pattern: /^\+(?:haunt|haunts|dive|dives|booth)(?:\/(\S+))?(?:\s+(.*))?$/i,
  lock: "connected",
  category: "Sprawl Goons",
  help: `+haunt [go <slug>|<name>]  — RP hangouts (bars, clinics, booths).

Jack in only when staff linked a floor.

Examples:
  +haunt
  +haunt go static-lounge
  +haunt noodle-noir
  +dive
  +booth`,

  exec: async (u: IUrsamuSDK) => {
    const sw = (u.cmd.args[0] ?? "").toLowerCase().trim();
    const arg = u.util.stripSubs(u.cmd.args[1] ?? "").trim();
    const q = arg.toLowerCase();

    const goArg = sw === "go" || sw === "jack" || sw === "in" || sw === "slide"
      ? arg
      : (/^(go|jack|in|slide)\s+/i.test(arg)
        ? arg.replace(/^(go|jack|in|slide)\s+/i, "").trim()
        : "");

    if (goArg || sw === "go" || sw === "jack" || sw === "in" || sw === "slide") {
      const target = goArg || arg;
      if (!target) {
        u.send(`${ERR}Usage: ${val("+haunt go <slug>")}`);
        return;
      }
      const r = await jackHangout(u, target);
      u.send(r.ok ? `${OK}${r.msg}` : `${ERR}${r.msg}`);
      if (r.ok) {
        const { emitHauntFrame } = await import("./client-sync.ts");
        await emitHauntFrame(u, r.msg);
      }
      return;
    }

    if ((!arg && !sw) || sw === "list" || q === "list") {
      const rows = await hangoutCatalog();
      const lines = [header("HAUNTS · DIVES · BOOTHS")];
      for (const h of rows) {
        const jack = h.open ? ylw("OPEN") : dim("DARK");
        lines.push(
          `  ${dim(h.kind.padEnd(8))} ` +
            `${ylw(h.name)}  ${jack}  ` +
            `${dim(h.slug)}`,
        );
      }
      lines.push(
        `  ${dim("+haunt go <slug> slides in — OPEN floors only")}`,
      );
      lines.push(footer());
      const { emitHauntFrame } = await import("./client-sync.ts");
      await emitHauntFrame(u, lines.join("\r\n"));
      return;
    }

    const rows = await hangoutCatalog();
    const hit = rows.find((h) =>
      h.slug.toLowerCase() === q ||
      h.name.toLowerCase().includes(q) ||
      h.kind.toLowerCase() === q
    );
    if (!hit) {
      u.send(
        `${ERR}Unknown haunt. ${val("+haunt")} for the board.`,
      );
      return;
    }

    // Exact slug match → try jack (client path)
    if (hit.slug.toLowerCase() === q) {
      if (!hit.open) {
        u.send(
          `${ERR}${hit.name} is DARK — no floor linked. ` +
            `Staff has to assign a room first.`,
        );
        return;
      }
      const r = await jackHangout(u, hit.slug);
      u.send(r.ok ? `${OK}${r.msg}` : `${ERR}${r.msg}`);
      if (r.ok) {
        const { emitHauntFrame } = await import("./client-sync.ts");
        await emitHauntFrame(u, r.msg);
      }
      return;
    }

    const lines = [
      header(hit.name),
      `  ${dim(hit.kind)}  ${dim(hit.slug)}  ` +
        (hit.open ? ylw("OPEN") : dim("DARK")),
    ];
    if (hit.blurb) lines.push(...wrap(hit.blurb, 74, "  "));
    if (hit.open) {
      lines.push(`  ${dim("+haunt go " + hit.slug + " to slide in")}`);
    } else {
      lines.push(`  ${dim("No linked room — jack-in locked.")}`);
    }
    lines.push(footer());
    u.send(lines.join("\r\n"));
  },
});
