# Development workflow

This guide covers how to get the project running locally, keep your environment
in sync, and follow the conventions used in the repository.

## Tooling

- **Node.js** – v18 or newer. The project is tested against the LTS release.
- **Package manager** – pnpm 9 is recommended (a `pnpm-lock.yaml` is committed).
  npm or yarn will work, but pnpm yields the fastest installs and deterministic
  lockfile behaviour.
- **Database** – Supabase Postgres with Realtime enabled. The SQL scripts in
  [`scripts/`](../scripts) manage schema creation, RLS policies, and helper
  functions.

Optional helpers:

- Supabase CLI (`supabase`) for running migrations locally.
- Vercel CLI (`vercel`) if you want to preview deploys from your machine.

## Project setup

```bash
pnpm install
cp .env.local.example .env.local   # if you maintain a sample file
```

Populate `.env.local` with Supabase credentials, the OpenAI-compatible API key,
and any OAuth callback URLs. See the [README](../README.md#environment-variables)
for an authoritative list.

To start the dev server:

```bash
pnpm dev
```

Next.js runs on http://localhost:3000 by default. Sign in with an existing
Supabase user or use the local Supabase Auth emulator if configured.

## Database migrations

The SQL files are idempotent and can be re-run safely. Recommended order:

1. `01-create-tables.sql`
2. `create_canvas_comments_table.sql`
3. `create_canvas_history_table.sql`
4. `04-create-ai-queue-table.sql`
5. `05-add-text-columns.sql`
6. `04-enable-realtime.sql`
7. Remaining helper scripts as needed

When using the Supabase CLI, place the scripts in a migration folder and execute
`supabase db push`. For hosted projects, paste each file into the SQL editor in
the dashboard.

### Local development Supabase instance

If you are running Supabase locally, ensure realtime replication is enabled by
updating the `supabase/config.toml` file or by executing the
`04-enable-realtime.sql` script manually. Realtime needs to know about each table
used by the app (`canvas_objects`, `canvas_comments`, `canvas_history`,
`ai_operations_queue`).

## Code structure

- `app/` contains all Next.js routes. The canvas experience lives in
  `app/canvas/page.tsx` and mounts the collaborative UI once the user is
  authenticated.
- `components/` houses reusable UI components (canvas renderer, toolbars,
  comments panel, AI chat, presence panel, etc.).
- `hooks/` exposes stateful logic for realtime sync, AI queues, presence,
  keyboard shortcuts, and colour history.
- `lib/` provides data-layer helpers such as Supabase clients, alignment
  algorithms, history utilities, and export helpers.

A high-level description of each subsystem is available in
[docs/architecture.md](./architecture.md).

## Coding conventions

- React components are written as function components with hooks. Client-only
  components are annotated with the "use client" directive.
- Tailwind CSS classes favour composable utility classes over custom CSS.
- Console logging follows the `[v0]` prefix convention to aid filtering during
  debugging.
- TypeScript types for canvas objects and presence data live in `lib/types.ts`.
  Extend them before using new properties.
- Avoid wrapping imports in try/catch and keep side effects out of module scope
  so that server components remain tree-shakable.

## Testing & quality

- Run `pnpm lint` before committing significant changes.
- Manual QA is recommended because the project does not currently ship with an
  automated test suite.
- Watch the `[v0] [PERF]` console logs (FPS, latency) to spot performance
  regressions when dealing with large canvases.

## Debugging tips

- Realtime issues: check the browser console for `[v0]` logs related to
  `useRealtimeCanvas` or Supabase channel statuses.
- AI issues: inspect the queue table (`ai_operations_queue`) from the Supabase
  dashboard to see stuck or failed operations. The chat UI also surfaces
  validation failures returned by the API.
- Presence ghosts: ensure the `usePresence` cleanup routines ran; manually delete
  lingering rows from `user_presence` if needed.

## Resetting state during development

Run the helper scripts in `scripts/` to clear the database:

- `03-clear-canvas-objects.sql` – remove all canvas objects
- `clear_all_sessions*.sql` – clear Supabase auth session rows
- `02-delete-all-accounts.sql` / `03-delete-all-accounts.sql` – purge users
  (use cautiously!)

With Supabase CLI you can also run `supabase db reset` to rebuild the schema from
migrations.
