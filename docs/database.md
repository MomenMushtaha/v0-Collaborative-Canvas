# Database schema

CollabCanvas uses Supabase (Postgres + Realtime) for persistence, authentication,
and broadcast channels. All SQL lives in [`scripts/`](../scripts).

## Core tables

### `canvas_objects`

Stores every drawable item on the canvas.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key, defaults to `gen_random_uuid()` |
| `canvas_id` | `text` | Logical canvas identifier ("default" in the MVP) |
| `type` | `text` | One of rectangle, circle, triangle, line, text, group |
| `x`, `y` | `real` | Position in canvas coordinates |
| `width`, `height` | `real` | Dimensions |
| `rotation` | `real` | Degrees, defaults to 0 |
| `fill_color`, `stroke_color` | `text` | Hex values |
| `stroke_width` | `real` | Defaults to 2 |
| `text_content`, `font_size`, `font_family` | `text` / `real` | Populated for text layers |
| `created_by` | `uuid` | References `auth.users` |
| `created_at`, `updated_at` | `timestamptz` | Timestamps |

Indexes: `idx_canvas_objects_canvas_id`.

RLS policies allow authenticated users to select/insert/update/delete.

### `user_presence`

Tracks connected collaborators and cursor metadata.

Columns mirror the `UserPresence` type in `lib/types.ts` (`user_id`,
`user_name`, `cursor_x`, `cursor_y`, `color`, `last_seen`). Presence rows are
created when a user opens the canvas and cleaned on teardown.

### `canvas_comments`

Annotation storage for comment pins.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `canvas_id` | `text` | Canvas identifier |
| `x`, `y` | `real` | Pin coordinates |
| `content` | `text` | Markdown/plain text body |
| `created_by` | `uuid` | Comment author |
| `created_by_name` | `text` | Snapshot of the author display name |
| `created_at`, `updated_at` | `timestamptz` | Timestamps |
| `resolved` | `boolean` | Defaults to false |
| `resolved_by`, `resolved_at` | `uuid`, `timestamptz` | Populated when resolved |

Indexes on `canvas_id` and `created_at` keep comment queries fast. Policies allow
users to read all comments, and create/update/delete their own entries. Policy
patch scripts (`fix_canvas_comments_rls_*.sql`) expand capabilities as the
workflow evolves.

### `canvas_history`

Stores snapshot history records created via the History panel.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `canvas_id` | `text` | Canvas identifier |
| `snapshot` | `jsonb` | Serialized array of `CanvasObject` entries |
| `created_by`, `created_by_name` | `uuid`, `text` | Author metadata |
| `created_at` | `timestamptz` | Timestamp |
| `description` | `text` | Optional label |
| `object_count` | `integer` | Denormalised count for quick display |

Authenticated users may read all snapshots and insert new ones they authored.

### `ai_operations_queue`

Managed queue of AI work items.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | Primary key |
| `canvas_id` | `text` | Canvas identifier |
| `user_id`, `user_name` | `uuid`, `text` | Requesting user |
| `status` | `text` | `pending`, `processing`, `completed`, or `failed` |
| `prompt` | `text` | Original user prompt |
| `operations` | `jsonb` | Serialized operations returned by the AI |
| `error_message` | `text` | Failure reason |
| `created_at`, `started_at`, `completed_at` | `timestamptz` | Timeline metadata |

Indexes on `canvas_id`, `status`, and `created_at` support queue lookups.
Policies permit authenticated users to view and manage queue entries. The
`cleanup_old_ai_operations` function deletes completed/failed items older than an
hour; schedule it via Supabase cron if desired. The default API route inserts
rows with `processing` status and upgrades them to `completed` when operations
are returned. Failures currently leave the row untouched, so clear or update it
manually if needed.

### `user_sessions`

Optional helper table (created by `create_user_sessions_table.sql`) that mirrors
Supabase auth session tokens for debugging and cleanup scripts.

## Realtime configuration

`04-enable-realtime.sql` registers each table with Supabase Realtime. Ensure the
script runs for production deployments so channels receive Postgres changes.
Realtime channels used by the client:

- `canvas:{id}:objects` – broadcasted create/update/delete payloads for objects
- `canvas:{id}:cursors` – cursor movement events (broadcast channel with `self`
  disabled)
- `canvas:{id}:comments` – comment change broadcasts triggered from
  `lib/comments-utils.ts`
- `ai-queue:{id}` – Postgres changes feed for queue updates

## Maintenance scripts

- `03-clear-canvas-objects.sql` – removes all records from `canvas_objects`
- `clear_all_sessions*.sql` – clears session tables to sign out all users
- `02-delete-all-accounts.sql`, `03-delete-all-accounts.sql` – development-only
  utilities to purge auth users

Run these sparingly—most are destructive and intended for local resets.
