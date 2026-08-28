#!/usr/bin/env -S deno run -A --minimum-dependency-age=0
/**
 * Court-local updater (CLI twin of in-game @restart / @update).
 *
 * 1. git pull --ff-only (optional branch arg)
 * 2. Bump every jsr:@ursamu/* pin in deno.json to latest
 * 3. deno cache --reload entrypoints
 *
 * Does not reboot — use `deno task restart` after, or @restart in-game.
 *
 * Usage:
 *   deno task update
 *   deno run -A scripts/update.ts main
 */

const DENO_JSON = "deno.json";
const JSR_PKG =
  /^jsr:(@ursamu\/[a-z0-9][a-z0-9._-]*)(?:@([^/\s]+))?(\/.*)?$/i;

const branch = (Deno.args[0] ?? "").trim();
const root = new URL("..", import.meta.url);
const cwd = root.pathname;
const denoJsonPath = new URL(`../${DENO_JSON}`, import.meta.url);

async function run(
  bin: string,
  args: string[],
): Promise<{ ok: boolean; out: string; err: string }> {
  const proc = await new Deno.Command(bin, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return {
    ok: proc.success,
    out: dec.decode(proc.stdout).trim(),
    err: dec.decode(proc.stderr).trim(),
  };
}

// --- git pull -----------------------------------------------------------
const inside = await run("git", ["rev-parse", "--is-inside-work-tree"]);
if (inside.ok && inside.out === "true") {
  if (branch) {
    if (!/^[\w./-]+$/.test(branch) || branch.startsWith("-")) {
      console.error(`Invalid branch: ${branch}`);
      Deno.exit(1);
    }
  }
  const fetch = await run("git", ["fetch", "--all", "--prune"]);
  if (!fetch.ok) {
    console.error("git fetch failed:", fetch.err || fetch.out);
    Deno.exit(1);
  }
  const pullArgs = branch
    ? ["pull", "--ff-only", "origin", branch]
    : ["pull", "--ff-only"];
  const pull = await run("git", pullArgs);
  console.log(pull.out || pull.err || "Already up to date.");
  if (!pull.ok) Deno.exit(1);
} else {
  console.log("Not a git checkout — skip pull.");
}

// --- bump jsr:@ursamu/* -------------------------------------------------
const raw = await Deno.readTextFile(denoJsonPath);
const denoJson = JSON.parse(raw) as {
  imports?: Record<string, string>;
  minimumDependencyAge?: number | string;
  [k: string]: unknown;
};
const imports = denoJson.imports;
if (!imports) {
  console.error("deno.json has no imports map.");
  Deno.exit(1);
}

const pkgs = new Set<string>();
for (const val of Object.values(imports)) {
  const m = val.match(JSR_PKG);
  if (m) pkgs.add(m[1]);
}

const latest = new Map<string, string>();
for (const pkg of pkgs) {
  const res = await fetch(`https://jsr.io/${pkg}/meta.json`);
  if (!res.ok) {
    console.warn(`skip ${pkg}: HTTP ${res.status}`);
    continue;
  }
  const meta = await res.json() as { latest?: string };
  if (meta.latest) latest.set(pkg, meta.latest);
}

let dirty = false;
for (const [key, val] of Object.entries(imports)) {
  const m = val.match(JSR_PKG);
  if (!m) continue;
  const ver = latest.get(m[1]);
  if (!ver) continue;
  const oldRange = m[2] ?? "";
  const suffix = m[3] ?? "";
  const prefix = oldRange.startsWith("~")
    ? "~"
    : oldRange.startsWith("^") || oldRange === ""
    ? "^"
    : oldRange.startsWith(">=")
    ? ">="
    : "^";
  const next = `jsr:${m[1]}@${prefix}${ver}${suffix}`;
  if (next === val) continue;
  console.log(`${key}: ${val} → ${next}`);
  imports[key] = next;
  dirty = true;
}

if (denoJson.minimumDependencyAge !== 0) {
  denoJson.minimumDependencyAge = 0;
  dirty = true;
  console.log("Set minimumDependencyAge = 0");
}

if (dirty) {
  await Deno.writeTextFile(
    denoJsonPath,
    JSON.stringify(denoJson, null, 2) + "\n",
  );
  console.log("Updated deno.json");
} else {
  console.log("JSR @ursamu/* pins already current.");
}

// --- cache --------------------------------------------------------------
const toCache: string[] = [];
for (const e of ["src/main.ts", "src/telnet.ts"]) {
  try {
    await Deno.stat(new URL(`../${e}`, import.meta.url));
    toCache.push(e);
  } catch {
    /* missing */
  }
}

if (toCache.length) {
  console.log(`Re-caching: ${toCache.join(", ")}`);
  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      "cache",
      "--reload",
      "--minimum-dependency-age=0",
      ...toCache,
    ],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await cmd.spawn().status;
  if (!status.success) {
    console.warn("deno cache exited non-zero");
    Deno.exit(status.code || 1);
  }
}

console.log("Done. Run: deno task restart");
