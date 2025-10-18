# CollabCanvas Conflict Resolution Strategy

## Overview

CollabCanvas uses a **Last-Write-Wins (LWW)** conflict resolution strategy combined with optimistic updates and real-time synchronization to handle concurrent edits in a multi-user collaborative environment.

## Strategy: Last-Write-Wins (LWW)

### Core Principle
When multiple users edit the same object simultaneously, the most recent change (based on timestamp) takes precedence and overwrites previous changes.

### Why LWW?
- **Simplicity**: Easy to implement and reason about
- **Performance**: No complex merge algorithms or coordination overhead
- **Real-time**: Works seamlessly with broadcast-based synchronization
- **Predictable**: Users see immediate feedback without waiting for conflict resolution

### Trade-offs
- **Potential Data Loss**: Earlier changes may be overwritten by later ones
- **No Merge**: Conflicting edits aren't merged; one wins completely
- **Acceptable for Canvas**: Visual design tools prioritize immediate feedback over perfect conflict resolution

## Implementation Details

### 1. Optimistic Updates
\`\`\`typescript
// User makes a change
updateObject(objectId, newProperties)
// ↓ Immediate local update (optimistic)
setObjects(prev => prev.map(obj => 
  obj.id === objectId ? { ...obj, ...newProperties } : obj
))
// ↓ Broadcast to other users
broadcastObjectUpdate(objectId, newProperties)
// ↓ Persist to database (debounced 300ms)
saveToDatabase(objectId, newProperties)
\`\`\`

**Benefits**:
- Sub-50ms local updates (no network latency)
- Smooth user experience
- Changes appear instantly

### 2. Real-Time Synchronization

**Broadcast Channels**:
- `canvas:{canvasId}:objects` - Object create/update/delete
- `canvas:{canvasId}:cursors` - Real-time cursor positions
- `canvas:{canvasId}:ai_operations` - AI agent operations

**Flow**:
\`\`\`
User A edits object → Broadcast → User B receives → Apply update
\`\`\`

**Conflict Scenario**:
\`\`\`
Time: T0 - Object has { x: 100, y: 100 }
Time: T1 - User A sets x: 150 (broadcast at T1)
Time: T2 - User B sets x: 200 (broadcast at T2)
Result: All users see x: 200 (User B's change wins)
\`\`\`

### 3. Database Persistence

**Debounced Writes** (300ms):
- Reduces database load during rapid edits
- Groups multiple changes into single write
- Last change in the debounce window is persisted

**Row-Level Security (RLS)**:
- Ensures users can only modify objects in their canvas
- Prevents unauthorized overwrites

### 4. Reconnection & Queue

**During Disconnect**:
- Operations are queued locally
- User continues working offline
- Queue stored in memory (max 100 operations)

**On Reconnect**:
- Queued operations replayed in order
- Each operation broadcasts and persists
- Potential conflicts resolved via LWW

**Example**:
\`\`\`typescript
// User disconnects at T0
// User creates shape at T1 (queued)
// User moves shape at T2 (queued)
// User reconnects at T3
// → Both operations replay in order
// → If another user modified the shape, their changes may be overwritten
\`\`\`

## Conflict Scenarios & Handling

### Scenario 1: Simultaneous Move
**Setup**: User A and User B both move the same object

**Timeline**:
\`\`\`
T0: Object at (100, 100)
T1: User A moves to (150, 100) → broadcasts
T2: User B moves to (100, 150) → broadcasts
T3: User A receives User B's update → object at (100, 150)
T4: User B receives User A's update → object at (150, 100)
\`\`\`

**Resolution**: Last broadcast wins. If User B's broadcast arrives last at the server, all users converge to (100, 150).

**User Experience**: Brief flicker as object position updates, then stabilizes.

### Scenario 2: Delete vs. Edit
**Setup**: User A deletes an object while User B edits it

**Timeline**:
\`\`\`
T0: Object exists
T1: User A deletes object → broadcasts delete
T2: User B edits object → broadcasts update
\`\`\`

**Resolution**:
- If delete arrives first: Edit is ignored (object doesn't exist)
- If edit arrives first: Object briefly reappears, then deleted

**Implementation**:
\`\`\`typescript
// Edit handler checks if object exists
if (!objects.find(obj => obj.id === objectId)) {
  console.log('[v0] Ignoring update for deleted object')
  return
}
\`\`\`

### Scenario 3: Undo/Redo Conflicts
**Setup**: User A undoes while User B makes new changes

**Timeline**:
\`\`\`
T0: Object at (100, 100)
T1: User A moves to (150, 100)
T2: User B moves to (200, 100)
T3: User A undoes (back to 100, 100) → broadcasts
T4: User B sees object jump back to (100, 100)
\`\`\`

**Resolution**: User A's undo broadcasts the old state, overwriting User B's change.

**Mitigation**: Undo/redo only affects local user's history, but broadcasts still use LWW.

### Scenario 4: AI Agent Conflicts
**Setup**: AI agent creates objects while users are editing

**Timeline**:
\`\`\`
T0: User asks AI to "create a triangle"
T1: AI broadcasts create operation
T2: All users receive and apply operation
T3: If user was editing same area, AI object appears
\`\`\`

**Resolution**: AI operations use same LWW strategy. AI-created objects appear immediately for all users.

**Special Handling**: AI operations use viewport-aware positioning to avoid overlapping with existing objects.

## Visual Feedback

### Cursor Tracking
- Real-time cursor positions show where other users are working
- Helps users avoid editing the same objects
- Reduces conflict likelihood

### Selection Indicators
- Selected objects show colored borders (per user)
- Users can see what others are editing
- Encourages coordination

### Connection Status
- Banner shows "Reconnecting..." or "Offline" during disconnects
- Displays queued operation count
- Users know when changes may conflict

## Performance Characteristics

### Sync Latency
- **Local updates**: <50ms (optimistic)
- **Remote updates**: 100-300ms (network + broadcast)
- **Database persistence**: 300ms debounce + write time

### Conflict Window
- **Typical**: 100-300ms (network latency)
- **During disconnect**: Unbounded (until reconnect)
- **High load**: May increase to 500ms+

### Scalability
- **Tested**: 2-3 concurrent users
- **Expected**: 5-10 users without degradation
- **Limit**: Broadcast channel capacity (~50 users)

## Alternative Strategies Considered

### 1. Operational Transformation (OT)
**Pros**: Preserves all user intent, no data loss
**Cons**: Complex to implement, high latency, overkill for canvas
**Decision**: Rejected due to complexity

### 2. Conflict-Free Replicated Data Types (CRDTs)
**Pros**: Automatic conflict resolution, eventual consistency
**Cons**: Requires CRDT library, larger payload size, learning curve
**Decision**: Rejected due to implementation time

### 3. Locking
**Pros**: Prevents conflicts entirely
**Cons**: Poor UX (users blocked), requires coordination server
**Decision**: Rejected due to poor collaborative experience

## Future Improvements

### Short-term
1. **Conflict Notification**: Show toast when user's change is overwritten
2. **Undo Scope**: Make undo/redo user-specific (don't broadcast)
3. **Optimistic Rollback**: Detect conflicts and revert optimistic updates

### Long-term
1. **Hybrid Strategy**: Use OT for text editing, LWW for objects
2. **Conflict History**: Log conflicts for debugging
3. **Smart Merge**: Merge non-conflicting properties (e.g., color + position)

## Testing Conflict Resolution

### Manual Testing
1. Open canvas in two browser windows
2. Edit same object simultaneously
3. Verify last change wins
4. Test disconnect/reconnect with queued operations

### Automated Testing
\`\`\`typescript
// Test: Simultaneous updates
test('last write wins on simultaneous updates', async () => {
  const obj = { id: '1', x: 100, y: 100 }
  
  // User A updates
  await updateObject('1', { x: 150 })
  
  // User B updates (slightly later)
  await updateObject('1', { x: 200 })
  
  // Verify User B's change wins
  expect(getObject('1').x).toBe(200)
})
\`\`\`

## Conclusion

CollabCanvas's Last-Write-Wins strategy provides a simple, performant, and predictable conflict resolution approach suitable for real-time collaborative canvas editing. While it may occasionally overwrite changes, the trade-off is acceptable given the visual nature of the application and the benefits of immediate feedback and low latency.

The strategy is enhanced by:
- Real-time cursor tracking (reduces conflicts)
- Optimistic updates (smooth UX)
- Operation queuing (handles disconnects)
- Visual feedback (connection status)

For most collaborative canvas use cases, LWW provides the right balance of simplicity, performance, and user experience.
