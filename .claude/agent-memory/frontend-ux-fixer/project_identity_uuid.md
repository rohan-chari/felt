---
name: identity.ts UUID fallback for non-secure contexts
description: crypto.randomUUID() is unavailable on plain HTTP; identity.ts uses a DataView-based fallback
type: project
---

`apps/web/src/identity.ts` has a `uuidv4()` helper that:
1. Tries `crypto.randomUUID()` first (only works in HTTPS / localhost).
2. Falls back to `crypto.getRandomValues(new Uint8Array(16))` + DataView bit-twiddling for RFC 4122 v4/variant — works on any context including plain HTTP on a LAN IP.

Uses `DataView.getUint8/setUint8` instead of direct `Uint8Array[n]` indexing to avoid `noUncheckedIndexedAccess` TypeScript errors (TS2532 "Object is possibly undefined").

**Why:** Users loading the app from a non-HTTPS IP address (e.g., local network) had `TypeError: crypto.randomUUID is not a function` on first load, preventing identity creation and room join.
