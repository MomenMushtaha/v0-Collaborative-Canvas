# Conflict Resolution & State Management

## Strategy Summary
- **Approach**: _Last-Write-Wins (LWW)_ powered by per-object Lamport timestamps.
- **Metadata**: Every canvas object carries transient `meta` data (`lastModifiedAt`, `lastModifiedBy`, `lastModifiedByName`, `lastModifiedColor`, `lastOperation`).
- **Transport**: All realtime broadcasts wrap the payload in `{ object, meta }`, so recipients can resolve conflicts deterministically.
- **Persistence**: Database writes are debounced (300 ms) and sanitized so only storage-safe columns are persisted; meta fields never hit the database.
- **Offline safety**: When offline, operations (create/update/delete) are queued together with their metadata and replayed with the original timestamps once a connection is available.
- **Visual feedback**: The canvas renders a badge above recently edited objects showing who edited it and how long ago.

## Why Last-Write-Wins?
LWW gives predictable convergence for a visual canvas: users expect the newest mutation to be authoritative. We augment wall-clock `Date.now()` with a per-batch logical counter so simultaneous writes that share the same millisecond remain strictly ordered.

## Conflict Handling Mechanics

### Generating Updates
1. User interactions flow through `useCanvas`, which emits an updated `objects` array.
2. `useRealtimeCanvas.syncObjects` compares the new snapshot to the previous one (`objectsRef`).
3. For each changed object we compute:
   - `timestamp = Date.now() + logicalClock++`
   - `meta = { lastModifiedAt: timestamp, lastModifiedBy: userId, lastModifiedByName: userName, lastModifiedColor: userColor, lastOperation: "create" | "update" }`
4. `versionRef` tracks the latest timestamp per object, and `tombstoneRef` remembers deletes so stale updates cannot resurrect them.
5. We broadcast `{ object: <storage-safe object>, meta }` and stage the same envelope for database persistence.

### Receiving Updates
When a broadcast arrives (`hooks/use-realtime-canvas.ts`):
1. Compare `meta.lastModifiedAt` with `versionRef[id]` and `tombstoneRef[id]`.
2. If the incoming timestamp is older, drop the payload (prevents flicker/ghost objects).
3. Otherwise, store the new version and merge `meta` into local state so UI components can react (e.g., last edited badges).
4. Deletions update `tombstoneRef` ensuring subsequent stale creates/updates are ignored.

### Offline Queue
- While disconnected we still accept mutations; they are pushed into `operationQueueRef` with their original `{ object, meta }` envelopes.
- On reconnection we replay the queue in order, preserving timestamps so remote peers still apply LWW consistently.
- Connection status broadcasts queued operation counts to the UI so users understand their edits are pending.

### Rapid Edit Storms
- Every call to `syncObjects` may contain dozens of object mutations (drag, resize, color changes). Logical ordering within that batch ensures deterministic resolution even when all edits share the same wall clock millisecond.
- Debounced persistence keeps database writes bounded while realtime broadcasts happen immediately.

## Scenario Coverage
| Scenario | Behaviour |
| --- | --- |
| **Simultaneous Move** | Competing updates carry timestamps; the largest timestamp wins for all users, ensuring convergence without duplicate objects. |
| **Rapid Edit Storm** | Each property change increments the logical clock. Recipients process updates strictly in timestamp order, so a fast mix of move/resize/color edits remains consistent. |
| **Delete vs Edit** | Delete envelopes store a tombstone timestamp. Any later-arriving stale update with an older timestamp is ignored, preventing “ghost” objects. |
| **Create Collision** | Two creates receive distinct timestamps; LWW keeps whichever arrived last. Because IDs are unique, no duplicate objects are created. |

## Visual Feedback
Recent edits (<5 s) render a floating badge showing the editor’s name and color plus a relative timestamp (e.g., “Edited by Casey • just now”). This gives collaborators immediate awareness of active work and satisfies the “who last edited” requirement.

## Testing Checklist
- [x] Drag the same object from two browsers → final position matches the higher timestamp change.
- [x] Resize, recolor, and move the same object simultaneously → state stays consistent, no ghost nodes.
- [x] Delete an object while it is being edited → delete wins; tombstone blocks stale updates.
- [x] Create shapes rapidly while offline → queue replays in-order once reconnected, maintaining LWW semantics.
