/** Best-effort system mail via @ursamu/mail (optional peer). */
import type { IMail } from "@ursamu/mail";
import { mailDb } from "@ursamu/mail";
import { gameHooks, send, sessions } from "@ursamu/ursamu";

const SYSTEM = "#0";

export function mailDbref(id: string): string {
  const bare = String(id ?? "").replace(/^#/, "").trim();
  return bare ? `#${bare}` : SYSTEM;
}

export function mailNotifyLine(fromName = "OPS"): string {
  return `%chMAIL:%cn You have a new message from ${fromName}.`;
}

export function buildSprawlMail(opts: {
  to: string;
  subject: string;
  body: string;
  now?: number;
  id?: string;
}): IMail {
  const now = opts.now ?? Date.now();
  return {
    id: opts.id ?? `mail-sprawl-${now}-${Math.floor(Math.random() * 1e6)}`,
    from: SYSTEM,
    to: [mailDbref(opts.to)],
    subject: opts.subject,
    message: opts.body,
    date: now,
    read: false,
    folder: "inbox",
  };
}

function notifyInbox(playerId: string, fromName: string): void {
  try {
    const want = String(playerId ?? "").replace(/^#/, "").trim();
    const socks = sessions.list()
      .filter((s) => {
        const rec = s as unknown as { actorId?: string; sessionId?: string };
        const actor = String(rec.actorId ?? rec.sessionId ?? "")
          .replace(/^#/, "");
        return actor === want;
      })
      .map((s) => s.socketId)
      .filter(Boolean);
    if (socks.length) send(socks, mailNotifyLine(fromName), {});
  } catch (e: unknown) {
    console.error("[sprawl] mail notify failed:", e);
  }
}

export async function sendSprawlMail(opts: {
  to: string;
  subject: string;
  body: string;
  fromName?: string;
}): Promise<boolean> {
  const mail = buildSprawlMail(opts);
  const toId = mail.to[0]!.replace(/^#/, "");
  try {
    await mailDb.create(mail);
  } catch (e: unknown) {
    console.error("[sprawl] mail delivery failed:", e);
    return false;
  }
  notifyInbox(toId, opts.fromName ?? "OPS");
  try {
    await gameHooks.emit("mail:received", {
      to: toId,
      from: "0",
      subject: mail.subject,
      body: mail.message,
    });
  } catch (e: unknown) {
    console.error("[sprawl] mail:received:", e);
  }
  return true;
}

export async function mailChargenApproved(opts: {
  to: string;
  name: string;
  staff: string;
  notes?: string;
  job?: number | null;
}): Promise<void> {
  const job = opts.job != null ? `CGEN job: #${opts.job}` : "";
  const notes = opts.notes?.trim();
  await sendSprawlMail({
    to: opts.to,
    fromName: opts.staff || "OPS",
    subject: `Character approved: ${opts.name}`,
    body: [
      `You're cleared for the street, ${opts.name}.`,
      `Approved by: ${opts.staff}`,
      job,
      notes ? `\nStaff notes:\n${notes}` : "",
      ``,
      `In-game: +sheet  +roll  inv`,
    ].filter(Boolean).join("\n"),
  });
}
