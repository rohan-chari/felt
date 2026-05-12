---
name: Room page layout architecture
description: How the Room page's layout is structured — topbar, table sizing, side rail pattern
type: project
---

Room layout after the May 2026 polish pass:

- **Topbar** (`room-topbar`): full-width flex bar with three groups — `.room-topbar-left` (HostMenu inline, drops down via `position: absolute` on `.host-menu-body`), `.room-topbar-center` (room label + room-code + ShareLink), `.room-topbar-right` (History/Chat toggle buttons). HostMenu is no longer `position: fixed`.
- **Table size**: `.room-layout main` capped at `max-width: 860px` (was 1200px) — gives visible breathing room at ~1000px viewport.
- **Side rail** (`.side-rail`): unified right-side panel with tabbed History/Chat. Slides in from the right. Replaces the old split arrangement (history left, chat right). Toggle buttons live in the topbar-right group. Tab state: `sideOpen: boolean`, `sideTab: "chat" | "history"`. The `openSideTab(tab)` helper sets both in one call.
- **No more fixed-position chat/history toggles**: the old `.chat-toggle` and `.history-toggle` edge buttons are gone. CSS classes `chat-overlay`, `history-overlay`, `chat-toggle`, `history-toggle` are removed.

**Why:** At ~1000px viewport the 1200px max-width table was edge-to-edge; the split left/right panels felt disconnected; HostMenu at `fixed: top 16px left 16px` overlapped the room-code chip.
