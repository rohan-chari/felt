---
name: Home page visual hierarchy design
description: Documents the intended visual hierarchy and component structure of the Home page after the May 2026 redesign
type: project
---

Home page (`apps/web/src/pages/Home.tsx`) redesigned to prioritize the primary CTA and onboard new users.

**Visual hierarchy (top to bottom):**
1. Logo (`home-logo`) + tagline (`home-tagline`)
2. Three-step onboarding pills (`home-steps` ol, `.home-step-num` numbered circles in --accent)
3. Full-width "Create Room" CTA (`home-cta`) — block display, 20px, widest shadow
4. Error message if present
5. Quiet settings link (`home-settings-toggle`) — underlined, muted color, 12px — expands inline settings form
6. Footnote row (`home-footnote`) — 11px, muted: "Not you? Switch identity" button (`home-switch`)

**Why:** Settings toggle and identity switch were previously at the same visual weight as the CTA, competing with it and confusing new users who don't know to host vs wait.

**How to apply:** When editing the Home page, preserve this hierarchy. The CTA must remain the only bold/large interactive element. Settings and identity are utility affordances, not primary actions.
