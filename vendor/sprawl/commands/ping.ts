/** +ping — finger-style dossier. Fields on &PING-* / &ping-*. */
import { addCmd } from "@ursamu/ursamu";
import type { IDBObj, IUrsamuSDK } from "@ursamu/ursamu";
import {
  ARR,
  ERR,
  OK,
  dim,
  footer,
  header,
  val,
} from "./chrome.ts";
import {
  buildPingCard,
  parsePingSet,
  pingAttrName,
  pingImageOf,
  pingLabel,
  readPingField,
  type PingCard,
} from "../engine/ping.ts";
import { prefersSprawlJson, SPRAWL_UI } from "./frame.ts";

function flagBlob(obj: { flags?: unknown }): string {
  const f = obj.flags;
  if (f instanceof Set) return [...f].map(String).join(" ");
  if (Array.isArray(f)) return f.map(String).join(" ");
  return String(f ?? "");
}

async function findPlayer(
  u: IUrsamuSDK,
  who: string,
): Promise<IDBObj | null> {
  const q = who.trim();
  if (!q || /^me$/i.test(q)) return u.me;
  const hit = await u.util.target(u.me, q, true);
  if (hit && flagBlob(hit).toLowerCase().includes("player")) return hit;
  return hit ?? null;
}

function formatCard(card: PingCard): string {
  const lines = [
    header("PING"),
    `  ${val(card.name)}  ${dim(card.connected ? "LIVE" : "OFFLINE")}` +
      (card.staff ? ` ${dim("STAFF")}` : ""),
    `  Idle ${card.idle}`,
  ];
  for (const f of card.fields) {
    lines.push(`  ${f.label.padEnd(12)} ${f.value}`);
  }
  lines.push(footer("PING"));
  return lines.join("\r\n");
}

async function resolvePingImage(
  u: IUrsamuSDK,
  who: IDBObj,
): Promise<string> {
  const bag = pingImageOf(who);
  if (bag) return bag;
  try {
    const attr = await u.attr.get(who.id, "IMAGE");
    if (attr?.trim()) return attr.trim();
  } catch {
    /* optional */
  }
  return "";
}

function fieldText(card: PingCard): string {
  return card.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
}

async function showPing(u: IUrsamuSDK, who: IDBObj): Promise<void> {
  const base = buildPingCard(who, "now");
  const image = (await resolvePingImage(u, who)) || base.image || "";
  const card: PingCard = image ? { ...base, image } : base;
  const text = formatCard(card);
  if (prefersSprawlJson(u)) {
    const components: unknown[] = [
      { type: "header", title: card.name },
    ];
    if (image) {
      components.push({ type: "media", url: image, alt: card.name });
    }
    components.push({ type: "text", content: fieldText(card) });
    u.ui.layout({
      components,
      meta: { type: SPRAWL_UI, kind: "ping", data: card },
    });
    return;
  }
  u.send(text);
}

async function setPing(
  u: IUrsamuSDK,
  raw: string,
): Promise<void> {
  const parsed = parsePingSet(raw);
  if (!parsed) {
    u.send(`${ERR}Usage: ${val("+ping/set field=value")}`);
    return;
  }
  const label = pingLabel(parsed.field);
  if (parsed.value == null) {
    const cur = readPingField(u.me, parsed.field);
    if (cur == null) {
      u.send(`${ARR}No ping field ${val(parsed.field)}.`);
      return;
    }
    if (cur === "@@") {
      u.send(`${label} is hidden (@@).`);
      return;
    }
    u.send(`${label}: ${cur}`);
    return;
  }
  const attr = pingAttrName(parsed.field);
  if (parsed.field === "handle" || parsed.field === "alias") {
    if (!parsed.value) {
      await u.db.modify(u.me.id, "$unset", { "data.alias": 1 });
      u.send(`${OK}${label} cleared.`);
      return;
    }
    await u.db.modify(u.me.id, "$set", { "data.alias": parsed.value });
    u.send(`${OK}${label} → ${val(parsed.value)}`);
    return;
  }
  if (!u.attr?.set) {
    u.send(`${ERR}Cannot write attributes.`);
    return;
  }
  if (!parsed.value) {
    await u.attr.clear?.(u.me.id, attr);
    u.send(`${OK}${label} cleared.`);
    return;
  }
  await u.attr.set(u.me.id, attr, parsed.value);
  if (parsed.value === "@@") {
    u.send(`${OK}${label} hidden from +ping.`);
    return;
  }
  u.send(`${OK}${label} → ${val(parsed.value)}`);
}

addCmd({
  name: "+ping",
  pattern: /^\+ping(?:\/(\S+))?\s*(.*)/i,
  lock: "connected",
  category: "Sprawl Goons",
  help: `+ping [<player>]            — Dossier card (like +finger).
+ping/set <field>=<value>   — Set a field on yourself.
+ping/set <field>=          — Clear a field.

Fields: handle pronouns timezone prefs quote position
Custom: &ping-<name> me=<value>  (also /ping/set name=value)

Examples:
  +ping
  +ping Alice
  +ping/set pronouns=they/them
  &ping-quote me=Stay frosty.`,

  exec: async (u: IUrsamuSDK) => {
    const sw = (u.cmd.args[0] ?? "").toLowerCase().trim();
    const arg = u.util.stripSubs(u.cmd.args[1] ?? "").trim();
    if (sw === "set" || sw === "field") {
      await setPing(u, arg);
      return;
    }
    if (arg) {
      const t = await findPlayer(u, arg);
      if (!t) {
        u.send(`${ERR}No one matching ${val(arg)}.`);
        return;
      }
      await showPing(u, t);
      return;
    }
    await showPing(u, u.me);
  },
});
