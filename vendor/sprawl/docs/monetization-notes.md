# Sprawl monetization notes (draft)

**Status:** park for later — not implemented.  
**Context:** solo console + UrsaMU Sprawl Goons plugin; AI-GM (ASK GM / WIRE) already in the client loop.

Price band discussed: **$0.99–$1.99/mo**.

---

## What’s worth ~$1–2/mo

### 1. AI-GM (strongest paid layer)

Tokens cost real money; value is obvious.

| Tier | AI-GM |
|------|--------|
| Free | Hard daily drip (e.g. 5–10 asks), short replies |
| $0.99–1.99 | Higher cap, longer context, “remember this run,” better gig beats |
| Later | Private GM tone, multi-scene arcs, NPC voices |

**Rule:** free must still feel playable; show a remaining meter; even paid has a hard monthly ceiling.

### 2. Cosmetics + identity (easy, low guilt)

Non-pay-to-win chrome:

- District / haunt art packs (admin hooks already exist)
- Portrait frames, HUD skins, feed ribbons, splash variants
- Ping / dossier flair, title tags (“RUNNER”, “FIXER”)

**$0.99/mo** works as a bundle (“Street Pass”), not one skin SKU.

### 3. Convenience (not power)

- Extra saved loadouts / quick-swap kits
- Gig history + replay notes
- Wiki bookmarks / longer mail history
- Soft priority when busy (if multiplayer load matters)

Do **not** sell better dice, more AP, stronger guns, or skip-the-gig at this price.

### 4. Creator / host-lite (niche)

- Extra soft-claim haunt slots
- Scene / job board helpers
- One-shot AI assist for room blurbs (capped)

---

## What not to sell at $0.99–1.99

- Full game unlock forever (too cheap to raise later)
- Combat / roll advantage
- Unlimited AI with no ceiling
- “Skip the whole gig loop”

---

## Recommended stack for this project

```
Free     → full night of play; tiny AI drip; plain chrome
Street   → $0.99/mo  cosmetics + light AI bump
Runner   → $1.99/mo  real AI-GM budget + convenience
```

Optional one-shots later: art pack, weekend AI binge (still capped).

**Anchor SKU:** single **Runner Pass @ $1.99**.

---

## Why AI-GM + cosmetics

| Layer | Fit here |
|-------|----------|
| AI-GM | ASK GM / WIRE already exist; variable cost; clear WTP |
| Cosmetics | Districts/haunts/art admin already exist |
| Convenience | Supports solo console without P2W |

---

## Product rules

1. Free = complete session, just thinner AI and plain look.
2. Show the meter (“7 AI asks left today”).
3. Never sell outcomes — only voice, looks, memory, speed.
4. One clear CTA, not five micro-SKUs at launch.
5. Paid AI still has a hard monthly ceiling.

---

## Build order (when we pick this up)

1. Define Runner Pass entitlements (AI caps + one cosmetic lane + one convenience).
2. Stripe Checkout + webhook → character flag (`state.sprawl.sub` or similar).
3. Gate AI-GM first.
4. Cosmetic unlocks second.
5. Skip complex storefront until those two convert.

---

## Non-goals (for now)

- Implementing Stripe or entitlement checks in this pass
- Pay-to-win combat/gig hooks
- Multi-currency regional pricing design
