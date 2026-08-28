#!/usr/bin/env python3
"""Build gitignored .deno.local.json for local vendor mush.

deno.json stays JSR-only (prod). When vendor/mush exists, local run
scripts call this to point mush imports at ./vendor/mush without
touching the committed pin file.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DENO_JSON = ROOT / "deno.json"
OUT = ROOT / ".deno.local.json"
VENDOR_MOD = ROOT / "vendor" / "mush" / "mod.ts"

MUSH_OVERRIDES = {
    "ursamu": "./vendor/mush/mod.ts",
    "@ursamu/mush": "./vendor/mush/mod.ts",
    "@ursamu/mush/app": "./vendor/mush/src/app.ts",
    "@ursamu/mush/permissions": (
        "./vendor/mush/src/world/permissions.ts"
    ),
    "@ursamu/ursamu": "./vendor/mush/mod.ts",
    "@ursamu/ursamu/app": "./vendor/mush/src/app.ts",
}

# Bare + versioned JSR specs must hit the same module instance as
# @ursamu/mush or plugins register addCmd on a dead cmds array.
LOCAL_MUSH = "./vendor/mush/mod.ts"
LOCAL_MUSH_APP = "./vendor/mush/src/app.ts"
LOCAL_MUSH_PERM = "./vendor/mush/src/world/permissions.ts"

# Optional local monorepo plugin trees (symlink under vendor/).
LOCAL_PLUGIN_OVERRIDES = {
    "@ursamu/help": "./vendor/help/mod.ts",
    "@ursamu/help/register": "./vendor/help/register.ts",
    "@ursamu/help-plugin": "./vendor/help/mod.ts",

    "@ursamu/cofd": "./vendor/cofd-plugin/index.ts",
    "@ursamu/cofd-plugin": "./vendor/cofd-plugin/index.ts",
    "@ursamu/vendor": "./vendor/vendor-plugin/index.ts",
    "@ursamu/site": "./vendor/site-plugin/mod.ts",
    "@ursamu/channels": "./vendor/channels/mod.ts",
    "@ursamu/mail": "./vendor/mail/mod.ts",
    "@ursamu/mail-plugin": "./vendor/mail/mod.ts",
    "@ursamu/bbs": "./vendor/bbs/mod.ts",
    "@ursamu/jobs": "./vendor/jobs/mod.ts",
    "@ursamu/jobs-plugin": "./vendor/jobs/mod.ts",
    "@ursamu/ursamu/jobs": "./vendor/jobs/mod.ts",
    "@ursamu/discord": "./vendor/discord/mod.ts",
}


def _rewrite_mush_targets(mapping: dict) -> dict:
    out = {}
    for k, v in mapping.items():
        key = str(k)
        val = str(v)
        if key in (
            "ursamu",
            "@ursamu/mush",
            "@ursamu/ursamu",
        ) or key.startswith("jsr:@ursamu/mush"):
            if key.endswith("/app") or val.endswith("/app.ts") or (
                "/app" in key and "mush" in key
            ):
                out[k] = LOCAL_MUSH_APP
            elif "permissions" in key or val.endswith("permissions.ts"):
                out[k] = LOCAL_MUSH_PERM
            else:
                out[k] = LOCAL_MUSH
        elif isinstance(v, str) and (
            v.startswith("jsr:@ursamu/mush")
            or v == "@ursamu/mush"
        ):
            out[k] = LOCAL_MUSH
        else:
            out[k] = v
    return out


def main() -> int:
    if not VENDOR_MOD.is_file():
        if OUT.exists():
            OUT.unlink()
        print("no vendor/mush — using deno.json (JSR)", file=sys.stderr)
        return 1

    cfg = json.loads(DENO_JSON.read_text())
    imports = dict(cfg.get("imports") or {})
    imports.update(MUSH_OVERRIDES)
    active_local: dict[str, str] = {}
    for k, v in LOCAL_PLUGIN_OVERRIDES.items():
        rel = v.lstrip("./")
        if (ROOT / rel).exists() or (ROOT / rel).is_symlink():
            imports[k] = v
            active_local[k] = v
    # Pin every jsr:@ursamu/<pkg>@… import to the local tree when present
    # so plugins never load a second JSR copy of mail/vendor/channels.
    for k, v in list(imports.items()):
        ks = str(k)
        if not ks.startswith("jsr:@ursamu/"):
            continue
        # jsr:@ursamu/mail@2.7.0 → mail
        body = ks[len("jsr:@ursamu/") :]
        pkg = body.split("@", 1)[0]
        for bare, local in active_local.items():
            name = bare.replace("@ursamu/", "").replace("-plugin", "")
            if pkg == name or pkg == f"{name}-plugin":
                imports[k] = local
                break
    cfg["imports"] = _rewrite_mush_targets(imports)

    scopes = dict(cfg.get("scopes") or {})
    for sk, sm in list(scopes.items()):
        if isinstance(sm, dict):
            scopes[sk] = _rewrite_mush_targets(sm)
    # Symlinked local plugin trees (realpath under monorepo)
    local_scope = {
        "@ursamu/mush": LOCAL_MUSH,
        "@ursamu/help": "./vendor/help/mod.ts",
        "@ursamu/help/register": "./vendor/help/register.ts",
        "@ursamu/help-plugin": "./vendor/help/mod.ts",
        "@ursamu/ursamu": LOCAL_MUSH,
        "ursamu": LOCAL_MUSH,
    }
    for scope_key in (
        "file:///Users/kumakun/github/ursamu/packages/vendor/",
        "file:///Users/kumakun/github/court/vendor/vendor-plugin/",
        "file:///Users/kumakun/github/ursamu/packages/mail/",
        "file:///Users/kumakun/github/court/vendor/mail/",
        "file:///Users/kumakun/github/ursamu/packages/channels/",
        "file:///Users/kumakun/github/court/vendor/channels/",
        "file:///Users/kumakun/github/ursamu/packages/bbs/",
        "file:///Users/kumakun/github/court/vendor/bbs/",
        "file:///Users/kumakun/github/ursamu/packages/jobs/",
        "file:///Users/kumakun/github/ursamu/packages/help/",
        "file:///Users/kumakun/github/court/vendor/help/",
        "file:///Users/kumakun/github/ursamu/packages/site/",
        "file:///Users/kumakun/github/court/vendor/site-plugin/",
        "file:///Users/kumakun/github/court/vendor/site/",
        "file:///Users/kumakun/github/court/vendor/jobs/",
        "file:///Users/kumakun/github/ursamu/packages/discord/",
        "file:///Users/kumakun/github/court/vendor/discord/",
    ):
        scopes[scope_key] = dict(local_scope)
    cfg["scopes"] = scopes

    OUT.write_text(json.dumps(cfg, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)} (vendor mush)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
