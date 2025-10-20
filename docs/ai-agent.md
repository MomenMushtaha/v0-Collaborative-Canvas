# AI agent

The AI assistant allows collaborators to describe layout changes in natural
language. This page explains how prompts are processed, how operations are
validated, and what tooling is available.

## Request flow

1. **User prompt** – `components/ai-chat.tsx` captures the prompt, along with the
   current canvas objects, selected IDs, viewport, and usable canvas bounds.
2. **Queue entry** – `app/api/ai-canvas/route.tsx` receives the payload and, when
   possible, inserts a `processing` row in `ai_operations_queue` using the
   service-role Supabase client. This makes in-flight work visible to other
   clients.
3. **Tool execution** – The route invokes the Vercel AI SDK `streamText` helper
   with the defined toolset. Each tool validates input with `zod`, translates the
   request into serialisable operations, and appends them to an `operations`
   array. No database changes occur at this stage.
4. **Streaming response** – Assistant messages and operation payloads are
   streamed back to the browser. After streaming finishes the queue row is
   updated to `completed` with the operations JSON.
5. **Operation replay** – `components/collaborative-canvas.tsx` consumes the
   operations sequentially, applying them to local state and syncing each change
   via `useRealtimeCanvas` so every collaborator sees the update. The
   `useAIQueue` hook marks queue items as processed locally to avoid duplicate
   replays on reconnect.

Failures return an error response to the chat UI. The queue row is not updated
automatically, so it may remain in the `processing` state until cleaned up
manually. Validation errors are surfaced inline so users can adjust their prompt
without leaving the canvas.

## Tool catalogue

The agent exposes a mix of low-level shape manipulation tools and higher-level
layout generators. All tools are defined in
`app/api/ai-canvas/route.tsx` using the Vercel AI SDK `tool` helper.

### Shape & canvas manipulation

- `getCanvasState` – Return counts, object metadata, or selection details without
  mutating the canvas.
- `createShape` – Draw rectangles, circles, triangles, and lines with size,
  colour, and optional coordinates. Defaults to the visible viewport centre.
- `moveShape` – Move individual or grouped objects by absolute coordinates or
  delta offsets. Supports targeting by index, selection, or type+colour queries.
- `resizeShape` – Resize objects by new dimensions or scale factors; supports
  batch operations with `applyToAll`.
- `rotateShape` – Rotate by absolute or relative degrees, mirroring the selection
  resolution rules used by `moveShape`.
- `deleteShape` – Remove selected objects, specific indices, or clear the canvas.
- `deleteShapesByType` / `deleteShapesByColor` – Bulk deletion helpers when a
  request references all shapes of a given type or colour.
- `arrangeShapes` – Arrange objects into rows, columns, grids, circles, or custom
  layouts with spacing parameters.
- `createText` – Place text layers with font size, colour, and optional
  positioning.

### Layout generators & utilities

- `createLoginForm` – Produce a multi-element login form (labels, inputs, button)
  with sensible spacing.
- `createNavigationBar` – Build a navigation header with menu items and optional
  CTA button.
- `createCardLayout` – Generate a card component containing media, text, and
  action button placeholders.
- `createDashboard` – Assemble a dashboard with KPI cards and charts, following
  domain-specific defaults (sales, analytics, admin, e-commerce).
- `fetchAndAnalyzeWebsite` – Retrieve remote page styles to inform follow-up
  design decisions.

Each generator leverages shared helpers (`generateLayout`, alignment utilities)
so results adhere to the current viewport and avoid overlapping panels.

## Context & validation

The route prepares a detailed prompt before invoking the model:

- Canvas dimensions, viewport bounds, and usable area (accounting for toolbars
  and panels) guide positioning.
- The full object list and selection indices help resolve pronouns such as “move
  those” or “make them red”.
- Conversation guidelines instruct the model to honour sequential commands,
  clarify ambiguous references, and avoid hallucinating absent shapes.

All tool inputs are validated. If validation fails, the tool returns an error and
adds a message to `validationErrors`, which is relayed to the user. Successful
operations include enough metadata for the UI to summarise actions in the chat
transcript.

## Queue behaviour

- Queue items can use `pending`, `processing`, `completed`, or `failed` statuses.
  The current API route writes rows as `processing` and upgrades them to
  `completed` after streaming operations. Errors return a 500 response and leave
  the queue row untouched, so manual cleanup may be required.
- `hooks/use-ai-queue.ts` subscribes to the `ai-queue:{canvasId}` channel and
  invokes `onOperations` when a `completed` item with operations appears. Each
  client records processed IDs to avoid duplicate replays on reconnect.
- The optional `cleanup_old_ai_operations` SQL function removes completed/failed
  entries older than one hour; schedule it to keep the queue compact.

## Extending the agent

1. Add new tool definitions in `app/api/ai-canvas/route.tsx`.
2. Update the available functions list in the prompt block so the model knows it
   can use the new capability.
3. Ensure `components/collaborative-canvas.tsx` understands the returned
   operation payload (the `applyOperation` helper handles most shapes) and mark
   the queue item as processed via `useAIQueue` if operations originate from the
   server.
4. Update the README and this document with the new tool description.
