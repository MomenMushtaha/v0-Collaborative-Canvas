# Architecture

This document expands on how CollabCanvas is put together and where the core
behaviours live in the codebase.

## High-level overview

```
Browser (Next.js App Router)
│
├─ Canvas UI (`app/canvas/page.tsx`)
│   ├─ Hooks
│   │   ├─ `useRealtimeCanvas` – object sync & offline queueing
│   │   ├─ `usePresence` – live cursors & presence lifecycle
│   │   ├─ `useHistory` – undo/redo stacks and snapshot plumbing
│   │   ├─ `useAIQueue` – realtime view of AI work items
│   │   └─ `useCanvas` – pointer interactions, selection logic
│   └─ Components (toolbars, panels, chat, cursor overlays)
│
├─ API routes (`app/api/*`)
│   ├─ `ai-canvas/route.tsx` – Vercel AI SDK endpoint with tool definitions
│   └─ `logout/route.ts` – Supabase session teardown
│
└─ Supabase (Postgres + Realtime)
    ├─ Tables: `canvas_objects`, `user_presence`, `canvas_comments`,
    │         `canvas_history`, `ai_operations_queue`
    └─ Realtime channels: per-canvas broadcasts for objects, cursors, comments,
       and AI queue Postgres changes
```

The client is intentionally stateful: every real-time subscription, undo stack,
queue, and comment feed lives inside browser memory for instant feedback.
Server-side code is limited to authentication helpers and the AI agent route.

## Canvas orchestration

`app/canvas/page.tsx` wires together authentication, hooks, and UI panels. It
owns local state for selected objects, panel layout, history snapshots, comment
mode, and grid preferences. It also registers cleanup handlers so the Supabase
session and presence record are removed when the tab closes.

The heavy lifting happens inside the hooks:

- `hooks/use-realtime-canvas.ts` bootstraps the canvas by loading persisted
  objects, subscribing to Supabase broadcasts, and queueing mutations while
  offline. A reconnect loop with exponential backoff flushes queued operations
  after connectivity is re-established.
- `hooks/use-canvas.ts` (and supporting alignment/group utilities) handle pointer
  events, hit-testing, marquee selection, drag handles, grouping, and clipboard
  interactions.
- `hooks/use-history.ts` maintains bounded undo/redo stacks, emitting console
  instrumentation for each command. History snapshots are stored separately via
  `lib/history-utils.ts`.

## Presence & cursors

`hooks/use-presence.ts` provisions a row in `user_presence`, continually refreshes
other participant data, and subscribes to the `canvas:{id}:cursors` broadcast
channel to draw live cursors. It performs duplicate record cleanup to remove
stale sessions and ensures presence rows are deleted on unmount.

The UI for presence lives in `components/presence-panel.tsx` and
`components/multiplayer-cursors.tsx`, which render avatars, colour swatches, and
cursor tooltips based on the hook output.

## Comments & annotations

Comments are stored in `canvas_comments` and exposed via `lib/comments-utils.ts`.
The utilities offer CRUD helpers that broadcast comment changes through
`canvas:{id}:comments`. `components/comments-panel.tsx` consumes the helper
methods to resolve, delete, and filter comments, while
`components/comment-marker.tsx` renders pins on the canvas itself.

A dedicated server broadcast (`subscribeToCommentBroadcasts`) coalesces updates
so comment lists remain responsive even before Postgres changefeeds arrive.

## AI workflow

The AI assistant is split across the UI (`components/ai-chat.tsx`), queue hook
(`hooks/use-ai-queue.ts`), and server route (`app/api/ai-canvas/route.tsx`).
Tool definitions cover shape manipulation as well as higher-level layout
generators (`createLoginForm`, `createNavigationBar`, `createCardLayout`,
`createDashboard`, `fetchAndAnalyzeWebsite`).

1. Users chat with the assistant; prompts are sent to the API route alongside
   current selection, viewport, and object state.
2. The API route creates/updates queue items in `ai_operations_queue` with a
   service-role Supabase client, then uses the Vercel AI SDK to execute tool
   calls. Tool implementations validate input with `zod`, derive positions based
   on the visible viewport, and enqueue side-effect-free operation descriptors.
3. Once the AI finishes, the client consumes streamed operations, adds them to
   the queue hook, and sequentially applies them inside
   `components/collaborative-canvas.tsx`. Each operation triggers a realtime
   sync so every collaborator sees the mutation immediately.

Queue items remain visible (status `pending`/`processing`) until processed, and
completed items are trimmed via the optional `cleanup_old_ai_operations` job.

## History & export

Manual checkpoints are inserted through `lib/history-utils.ts`, which stores the
entire canvas state in `canvas_history` with author metadata. The history panel
(`components/history-panel.tsx`) lists snapshots, formats “time ago” strings, and
restores prior states when requested.

Export functionality lives in `lib/export-utils.tsx`, supporting PNG and SVG
output. The exporter limits exports to objects within the current viewport (or
optionally the full canvas) and handles shape-specific rendering in both canvas
and SVG contexts.

## Supporting utilities

- Alignment, distribution, and grouping logic lives in `lib/alignment-utils.ts`,
  `lib/selection-utils.ts`, and `lib/group-utils.ts`.
- Session cleanup helpers (`lib/session-utils.ts`) coordinate with
  `app/api/logout/route.ts` to ensure Supabase sessions are invalidated when a
  tab closes.
- Colour and style helpers such as `components/color-picker.tsx` and
  `hooks/use-recent-colors.ts` back the styling panel.

Refer back to the README for directory descriptions and to the other documents
in the `docs/` folder for database and AI-specific details.
