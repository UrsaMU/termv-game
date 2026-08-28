/**
 * Ping card — sprawl +finger.
 * Fields live on &PING-* (also &ping-*). Hidden value @@.
 */
import type { IDBObj } from "@ursamu/ursamu";

export const PING_PREFIX = "PING-";

export type PingField = {
  key: string;
  label: string;
  value: string;
};

export const PING_BLANK = "-";

export type PingCard = {
  id: string;
  name: string;
  connected: boolean;
  staff: boolean;
  idle: string;
  image?: string;
  fields: PingField[];
};

export const PING_FIELDS: Array<{
  key: string;
  label: string;
  attr: string | null;
}> = [
  { key: "handle", label: "Handle", attr: null },
  { key: "pronouns", label: "Pronouns", attr: "PING-PRONOUNS" },
  { key: "timezone", label: "Timezone", attr: "PING-TIMEZONE" },
  { key: "prefs", label: "RP Prefs", attr: "PING-PREFS" },
  { key: "quote", label: "Quote", attr: "PING-QUOTE" },
  { key: "position", label: "Position", attr: "PING-POSITION" },
];

type Attr = { name: string; value: string };

export function pingAttrName(field: string): string {
  const key = field.trim().toLowerCase().replace(/\s+/g, "-");
  const hit = PING_FIELDS.find((f) => f.key === key);
  if (hit?.attr) return hit.attr;
  if (key === "handle" || key === "alias") return "ALIAS";
  return `${PING_PREFIX}${key.toUpperCase()}`;
}

export function pingLabel(field: string): string {
  const key = field.trim().toLowerCase().replace(/[_]+/g, "-");
  const hit = PING_FIELDS.find((f) => f.key === key);
  if (hit) return hit.label;
  return key
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || field;
}

export function attrsOf(obj: IDBObj | { state?: unknown; data?: unknown }): Attr[] {
  const rec = obj as {
    state?: { attributes?: Attr[] };
    data?: { attributes?: Attr[] };
  };
  const raw = rec.state?.attributes ?? rec.data?.attributes ?? [];
  return Array.isArray(raw) ? raw : [];
}

export function readAttr(
  obj: IDBObj | { state?: unknown; data?: unknown },
  name: string,
): string | undefined {
  const want = name.toUpperCase();
  const hit = attrsOf(obj).find((a) =>
    String(a.name ?? "").toUpperCase() === want
  );
  if (hit && hit.value != null) return String(hit.value);
  const data = (obj as { data?: Record<string, unknown>; state?: Record<string, unknown> })
    .data ??
    (obj as { state?: Record<string, unknown> }).state;
  const flat = data?.[name] ?? data?.[name.toLowerCase()];
  return typeof flat === "string" ? flat : undefined;
}

export function readPingField(
  obj: IDBObj | { state?: Record<string, unknown>; data?: Record<string, unknown> },
  field: string,
): string | undefined {
  const key = field.trim().toLowerCase().replace(/\s+/g, "-");
  if (key === "handle" || key === "alias") {
    const rec = obj as {
      state?: { alias?: string };
      data?: { alias?: string };
    };
    const a = rec.state?.alias ?? rec.data?.alias;
    return a == null || a === "" ? undefined : String(a);
  }
  return readAttr(obj, pingAttrName(key));
}

export function customPingFields(
  obj: IDBObj | { state?: unknown; data?: unknown },
): PingField[] {
  const reserved = new Set(
    PING_FIELDS.map((f) => (f.attr ?? "").toUpperCase()).filter(Boolean),
  );
  return attrsOf(obj)
    .filter((a) => {
      const n = String(a.name ?? "").toUpperCase();
      return n.startsWith(PING_PREFIX) && !reserved.has(n) &&
        a.value != null && a.value !== "@@";
    })
    .map((a) => {
      const key = String(a.name).slice(PING_PREFIX.length);
      return {
        key: key.toLowerCase(),
        label: pingLabel(key.toLowerCase()),
        value: String(a.value),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function pingImageOf(
  obj: IDBObj | { id?: string; state?: unknown; data?: unknown },
): string {
  const rec = obj as {
    id?: string;
    data?: Record<string, unknown>;
    state?: Record<string, unknown>;
  };
  const bag = { ...(rec.data ?? {}), ...(rec.state ?? {}) };
  const img = bag.image ?? bag.avatar;
  if (typeof img === "string" && img.trim()) return img.trim();
  const ext = bag.avatarExt ?? bag.imageExt;
  const id = String(rec.id ?? "").replace(/^#/, "");
  if (id && typeof ext === "string" && ext.trim()) {
    const e = ext.toLowerCase() === "jpeg" ? "jpg" : ext.toLowerCase();
    return `/avatars/${id}.${e}`;
  }
  return "";
}

export function displayPingValue(raw: string | undefined): string | null {
  if (raw === "@@") return null;
  const v = String(raw ?? "").trim();
  return v || PING_BLANK;
}

export function buildPingCard(
  obj: IDBObj,
  idle = "Offline",
): PingCard {
  const rec = obj as IDBObj & {
    data?: { name?: string; alias?: string };
    flags?: Set<string> | string | string[];
  };
  const name = String(
    rec.state?.name ?? rec.data?.name ?? rec.name ?? "Unknown",
  );
  const flags = rec.flags;
  const fl = flags instanceof Set
    ? [...flags].map(String)
    : Array.isArray(flags)
    ? flags.map(String)
    : String(flags ?? "").split(/\s+/);
  const connected = fl.some((f) => f.toLowerCase() === "connected");
  const staff = fl.some((f) =>
    /^(wizard|admin|staff|superuser)$/i.test(f)
  );
  const fields: PingField[] = [];
  for (const row of PING_FIELDS) {
    const shown = displayPingValue(readPingField(rec, row.key));
    if (shown == null) continue;
    fields.push({ key: row.key, label: row.label, value: shown });
  }
  fields.push(...customPingFields(rec));
  const image = pingImageOf(rec);
  return {
    id: String(rec.id ?? ""),
    name,
    connected,
    staff,
    idle: connected ? idle : "Offline",
    ...(image ? { image } : {}),
    fields,
  };
}

export function upsertAttr(attrs: Attr[], name: string, value: string): Attr[] {
  const want = name.toUpperCase();
  const next = attrs.filter((a) =>
    String(a.name ?? "").toUpperCase() !== want
  );
  if (value === "") return next;
  next.push({ name: want, value });
  return next;
}

export function parsePingSet(
  raw: string,
): { field: string; value: string | null } | null {
  const s = raw.trim();
  if (!s) return null;
  const eq = s.indexOf("=");
  if (eq < 0) {
    const field = s.toLowerCase().replace(/\s+/g, "-");
    return field ? { field, value: null } : null;
  }
  const field = s.slice(0, eq).trim().toLowerCase().replace(/\s+/g, "-");
  if (!field) return null;
  return { field, value: s.slice(eq + 1).trim() };
}
