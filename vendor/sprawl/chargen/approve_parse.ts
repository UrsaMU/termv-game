/** Split +chargen/approve <who>[=note] the same way reject does. */
export function parseWhoNote(arg: string): { who: string; notes: string } {
  const raw = String(arg ?? "").trim();
  const eq = raw.indexOf("=");
  if (eq < 0) return { who: raw, notes: "" };
  return {
    who: raw.slice(0, eq).trim(),
    notes: raw.slice(eq + 1).trim(),
  };
}
