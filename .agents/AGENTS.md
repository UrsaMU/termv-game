# cor — AI Agent Instructions

This repository contains game-specific files for an UrsaMU server built on
jsr:@ursamu/ursamu.

## Development Constraints
- **Line Length**: Enforce a maximum line width of 78 characters on all
  code and text modifications.
- **Type Checking**: Ensure all TypeScript files check out cleanly. Run
  `deno task test` or `deno check`.

## Commands
```bash
deno task start   # Run server in production
deno task dev     # Run server + telnet sidecar in watch mode
deno task test    # Run project tests
```

## Key Guidelines
- **Softcode Sandboxing**: Do not import Deno fs/net APIs in
  `system/scripts/`. All communication goes through the `u` SDK object.
- **Color Codes**: Ensure MUSH color codes (%cr, %cy, etc.) are always closed
  with %cn.
- **Database Ops**: Only write to DB via `$set`, `$inc`, and `$unset` operators.
- **Help Files**: Keep help files under 22 lines and 78 character columns.
