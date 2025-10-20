# CollabCanvas – real-time collaborative canvas with AI design partner

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/momenmushtahas-projects/v0-collaborative-canvas-mvp)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/projects/NUaCCUvSMZL)

CollabCanvas is a multiplayer whiteboard experience that pairs low-latency
collaboration with an AI assistant capable of drawing, arranging, and editing
objects on behalf of the team. The application is built on the Next.js 15 App
Router, streams real-time state through Supabase, and orchestrates AI-driven
changes with the Vercel AI SDK.

> **Live deployment**: https://vercel.com/momenmushtahas-projects/v0-collaborative-canvas-mvp

## Quick links

- [Architecture deep dive](./docs/architecture.md)
- [AI agent contract and tooling](./docs/ai-agent.md)
- [Database schema and migrations](./docs/database.md)
- [Development workflow](./docs/development.md)
- [Performance testing notes](./PERFORMANCE_TESTING.md)

## Table of contents

1. [Overview](#overview)
2. [Feature highlights](#feature-highlights)
3. [System architecture](#system-architecture)
4. [Directory layout](#directory-layout)
5. [Getting started](#getting-started)
6. [Using the canvas](#using-the-canvas)
7. [Operational notes](#operational-notes)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)
10. [Contributing](#contributing)
11. [License](#license)

## Overview

CollabCanvas enables remote teams to ideate together on a shared, persistent
canvas. Pointer movements, shape edits, and AI-generated changes propagate to
other collaborators through Supabase Realtime channels. The AI agent adds a
natural-language interface for arranging shapes, generating layouts, and
summarising the canvas state.

Key technology pillars:

- **Frontend** – Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4
  and shadcn/ui primitives for the interface.
- **Realtime data** – Supabase Realtime channels for objects, cursors, AI queue,
  comments, and history snapshots.
- **Persistence** – Supabase PostgreSQL with Row Level Security (RLS) enforced
  on all tables used by the application.
- **Authentication** – Supabase email/password and optional Google/GitHub OAuth
  sign in flows.
- **AI orchestration** – Vercel AI SDK streaming tool invocations to manage
  canvas operations and recordable AI queues.

## Feature highlights

### Collaboration & presence

- Real-time object sync managed by the `useRealtimeCanvas` hook, which queues
  mutations while offline and flushes them after reconnecting to Supabase.
- Live cursor broadcasting and presence cleanup handled through the
  `usePresence` hook, including duplicate session pruning and colour-coding of
  other collaborators.
- Supabase sessions are cleared on tab close via `/api/logout` and
  `lib/session-utils.ts` so presence rows do not linger.

### Canvas authoring

- Drawing primitives for rectangles, circles, triangles, lines, freeform
  text, and logical groups with transformation handles.
- Grid + snap controls, pan/zoom gestures, and keyboard shortcuts (undo/redo,
  duplicate, grouping, copy/paste) wired through dedicated hooks.
- Alignment and distribution helpers for multi-selection, layer visibility and
  lock toggles, and z-index ordering from the layers panel.
- Export to PNG or SVG of either the entire drawing or the current viewport
  selection.

### AI-assisted creation

- Natural-language chat powered by GPT-4o-mini through the Vercel AI SDK.
- Tool interface exposes validated operations for manipulating shapes
  (`getCanvasState`, `createShape`, `moveShape`, `resizeShape`, `rotateShape`,
  `deleteShape`, `deleteShapesByType`, `deleteShapesByColor`, `arrangeShapes`)
  alongside higher-level generators (`createText`, `createLoginForm`,
  `createNavigationBar`, `createCardLayout`, `createDashboard`,
  `fetchAndAnalyzeWebsite`) with strict validation, viewport awareness, and
  shared execution context defined in
  [`app/api/ai-canvas/route.tsx`](./app/api/ai-canvas/route.tsx).
- The server inserts an entry into `ai_operations_queue` for observability and
  updates it once operations are returned; the client applies the streamed
  operations sequentially so every collaborator sees the same mutations.

### Feedback & review

- Inline comment pins and a dedicated comments panel for discussing areas of
  the canvas. Comment resolution, deletion, and filtering flows are all
  synchronised in real time.
- Snapshot history viewer allowing collaborators to persist labelled checkpoints
  (`canvas_history` table) and restore previous states when necessary.
- Connection status indicator and toasts provide feedback on background work and
  reconnection attempts.

## System architecture

CollabCanvas follows a client-forward architecture with thin Next.js route
handlers and most orchestration completed in the browser. A high-level outline
is available in [docs/architecture.md](./docs/architecture.md); notable points
include:

- **Realtime synchronisation** – Canvas objects are loaded from `canvas_objects`
  and then synchronised via Supabase broadcast channels. Mutations are queued
  locally when offline and flushed after reconnection.
- **Presence** – Cursor updates are broadcast on `canvas:{id}:cursors` while a
  `user_presence` table records the latest known state and ownership.
- **AI agent** – AI requests are handled in `app/api/ai-canvas/route.tsx`, which
  validates tool calls, writes queue items with a service-role Supabase client,
  and streams back structured operations to the UI.
- **Comments & history** – Dedicated tables (`canvas_comments`, `canvas_history`)
  capture annotations and manual snapshots, with helper utilities for loading,
  broadcasting, and restoring records.

## Directory layout

```
app/                    # Next.js App Router routes and layouts
├── actions/            # Server actions for authentication flows
├── api/                # Route handlers (AI endpoint, logout)
├── canvas/             # Authenticated canvas experience
├── auth/               # Auth/sign-in routes
components/             # UI components (canvas, panels, chat, shadcn/ui wrappers)
hooks/                  # React hooks for realtime sync, presence, AI queue, history
lib/                    # Shared utilities (Supabase clients, alignment, comments, export)
public/                 # Static assets
scripts/                # Supabase SQL migrations and maintenance scripts
styles/                 # Tailwind base styles
```

## Getting started

### Prerequisites

- Node.js 18+
- pnpm 9.x (preferred) or npm/yarn
- Supabase project with Postgres and Realtime enabled
- Vercel account (for deployment) and OpenAI-compatible API key for the agent

### Installation

```bash
# Clone
git clone https://github.com/your-username/v0-collaborative-canvas-mvp.git
cd v0-collaborative-canvas-mvp

# Install dependencies
pnpm install    # or npm install / yarn install
```

### Environment variables

Create `.env.local` for local development and configure the following secrets:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key for client access |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key used by server-side queue management |
| `NEXT_PUBLIC_SITE_URL` | (Optional) Fully qualified site URL used in OAuth callbacks |
| `OPENAI_API_KEY` | API key for GPT-4o-mini via the Vercel AI SDK |

### Database setup

Supabase migrations live in [`scripts/`](./scripts). Run them in numerical order
with the SQL editor or the Supabase CLI:

1. `01-create-tables.sql` – `canvas_objects` and `user_presence`
2. `create_canvas_comments_table.sql` – collaborative annotations
3. `create_canvas_history_table.sql` – snapshot history tracking
4. `04-create-ai-queue-table.sql` – AI queue and cleanup helper
5. `05-add-text-columns.sql` – extended text support for objects
6. `04-enable-realtime.sql` – real-time replication configuration
7. `create_user_sessions_table.sql` and `clear_all_sessions*.sql` – optional
   helpers for session cleanup scripts

Apply policy fix-up scripts (`fix_canvas_comments_rls_*.sql`) if you run into RLS
errors while resolving comments.

### Running locally

```bash
pnpm dev
```

Visit http://localhost:3000 and sign in with a Supabase user. For OAuth (Google
or GitHub), configure provider credentials in the Supabase dashboard and ensure
redirect URLs include `/auth/callback`.

### Available scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the Next.js development server |
| `pnpm build` | Create a production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | Run Next.js lint checks |

## Using the canvas

### Creating and editing content

1. Pick a tool from the toolbar (rectangle, circle, triangle, line, text).
2. Drag on the canvas to create the object. Text layers prompt for content after
   placement.
3. Use handles to resize or rotate; drag anywhere on the selection to move.
4. Duplicate (`Ctrl/Cmd+D`), copy/paste, or delete with keyboard shortcuts.

The style panel exposes fill/stroke colours, stroke width, opacity, font
settings, and a recent colour history sourced from `useRecentColors`.

### Layout and alignment

- Shift+click or marquee-select to multi-select objects.
- Alignment buttons snap edges/centres; distribution buttons evenly space three
  or more objects horizontally or vertically.
- Grouping combines objects for joint transforms; groups can be nested and are
  represented via the `children`/`parent_group` fields in `CanvasObject`.

### Grid and viewport controls

- Toggle grid visibility, snap strength, and grid size through the grid controls
  component. Viewport pan/zoom state is shared with the AI so generated objects
  land inside the visible area.

### Collaboration workflows

- Live cursors display collaborator initials and colours. Presence data is
  periodically cleaned to avoid ghost cursors.
- Comment mode drops pins on the canvas, with the comments panel providing
  resolve/delete actions, filtering between active/resolved, and batch cleanup.
- Connection status toasts alert when the realtime channel disconnects and show
  queued operations count until reconnection succeeds.

### AI agent

- Launch the AI assistant from the bottom-right chat bubble.
- Prompts can request new layouts (e.g. “arrange the selected shapes in a grid”)
  or manipulations (“rotate the triangle 45 degrees”).
- Each AI response lists the operations executed and updates the shared queue so
  remote collaborators receive the same changes. Validation problems are echoed
  back in the chat transcript for quick follow-up.

Detailed contract, queue behaviour, and extension tips live in
[docs/ai-agent.md](./docs/ai-agent.md).

### History and exports

- Open the History panel to capture manual checkpoints. Snapshots include a
  description, author metadata, and the entire object array.
- Restore snapshots to revert the canvas for all users; the pending state is
  confirmed via `saveHistorySnapshot` utilities.
- Export the current viewport or entire canvas to PNG/SVG with configurable
  background colour and scale.

## Operational notes

### Real-time behaviour

- Object mutations are debounced before persisting to the database, while local
  state updates immediately for snappy feedback.
- During network interruptions, operations are queued (create/update/delete) and
  replayed with exponential backoff reconnection attempts.
- Supabase channel naming conventions:
  - `canvas:{id}:objects` – broadcast for object CRUD events
  - `canvas:{id}:cursors` – live cursor updates
  - `canvas:{id}:comments` – comment broadcasts
  - `ai-queue:{id}` – AI queue changes via `postgres_changes`

### Authentication & security

- Authenticated Supabase users are required for the canvas route; unauthenticated
  visitors are redirected to the landing page.
- Service-role access is restricted to server-side routes (AI queue) to avoid
  bypassing RLS from the browser.
- Session teardown clears local storage keys, Supabase sessions, and the
  `user_presence` record on browser unload.

### Performance instrumentation

- Console tracing prefixes (`[v0]`) annotate key flows (comments, history,
  realtime, AI) to make browser debugging easier.
- FPS and latency metrics are logged from canvas hooks so you can measure
  rendering performance during load testing.

## Deployment

### Deploy to Vercel

1. Push the repository to GitHub (or another supported Git provider).
2. Import the project into Vercel and supply environment variables matching
   `.env.local`.
3. Configure Supabase redirect URLs to include your production domain with the
   `/auth/callback` suffix.

### Supabase configuration checklist

- Enable Realtime on the relevant tables (`canvas_objects`, `canvas_comments`,
  `ai_operations_queue`, `canvas_history`).
- Confirm Row Level Security policies exist as defined in `scripts/`.
- Set up OAuth provider credentials (Google/GitHub) in Supabase if you plan to
  offer social login.
- Schedule the optional `cleanup_old_ai_operations` function via a Supabase
  cron job to prune historical AI queue entries.

## Troubleshooting

- **Missing shapes or stale data** – Ensure the Supabase Realtime config script
  has run and that your API keys are correct in `.env.local`.
- **AI queue stuck in “processing”** – Verify the service-role key is available
  to the API route and that the table exists. On errors the queue row will not
  be updated automatically, so inspect server logs and clear stale entries in
  `ai_operations_queue` from the Supabase dashboard if required.
- **OAuth redirect failures** – Confirm `NEXT_PUBLIC_SITE_URL` matches the domain
  passed to Supabase and that provider redirect URLs include `/auth/callback`.
- **Comment RLS errors** – Run the latest `fix_canvas_comments_rls_*.sql`
  migration to align policies with the current comment workflow.

## Contributing

Issues and pull requests are welcome. Please read
[docs/development.md](./docs/development.md) for local setup details, coding
conventions, and guidance on running lint checks before opening a PR.

## License

MIT License – see [LICENSE](./LICENSE) for details.
