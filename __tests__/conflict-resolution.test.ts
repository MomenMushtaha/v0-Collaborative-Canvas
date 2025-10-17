import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { LamportClock } from "../lib/realtime/lamport"
import { shouldApplyRemoteUpdate } from "../lib/realtime/conflict"
import {
  saveQueuedOperations,
  loadQueuedOperations,
  clearQueuedOperations,
  type PersistedQueuedOperation,
} from "../lib/state-persistence"
import type { CanvasObject } from "../lib/types"

class MemoryStorage {
  private store = new Map<string, string>()

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  clear() {
    this.store.clear()
  }
}

describe("Lamport clock", () => {
  it("increments monotonically and observes external values", () => {
    const clock = new LamportClock()

    assert.equal(clock.tick(), 1)
    assert.equal(clock.tick(), 2)

    clock.observe(10)
    assert.equal(clock.now(), 10)

    assert.equal(clock.tickFromTimestamp(5), 11)
    assert.equal(clock.now(), 11)

    assert.equal(clock.tickFromTimestamp(50), 50)
    assert.equal(clock.now(), 50)
  })
})

describe("Conflict resolution", () => {
  it("accepts newer versions and rejects stale ones", () => {
    assert.equal(
      shouldApplyRemoteUpdate({
        currentVersion: 10,
        incomingVersion: 11,
        currentUserId: "alice",
        incomingUserId: "bob",
      }),
      true,
    )

    assert.equal(
      shouldApplyRemoteUpdate({
        currentVersion: 11,
        incomingVersion: 10,
        currentUserId: "alice",
        incomingUserId: "bob",
      }),
      false,
    )
  })

  it("falls back to timestamps and user id tie breakers", () => {
    assert.equal(
      shouldApplyRemoteUpdate({
        currentVersion: 10,
        incomingVersion: 10,
        currentTimestamp: 1000,
        incomingTimestamp: 1500,
        currentUserId: "alice",
        incomingUserId: "bob",
      }),
      true,
    )

    assert.equal(
      shouldApplyRemoteUpdate({
        currentVersion: 10,
        incomingVersion: 10,
        currentTimestamp: 1500,
        incomingTimestamp: 1500,
        currentUserId: "bob",
        incomingUserId: "alice",
      }),
      false,
    )
  })
})

describe("Offline queue persistence", () => {
  const storage = new MemoryStorage()

  beforeEach(() => {
    ;(global as any).window = { localStorage: storage }
    storage.clear()
  })

  afterEach(() => {
    delete (global as any).window
    storage.clear()
  })

  it("saves, loads, and clears queued operations", () => {
    const canvasId = "canvas-test"
    const baseObject: CanvasObject = {
      id: "obj-1",
      canvas_id: canvasId,
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      fill_color: "#fff",
      stroke_color: "#000",
      stroke_width: 1,
    }

    const operations: PersistedQueuedOperation[] = [
      {
        type: "create",
        object: baseObject,
        version: 42,
        meta: { userId: "alice", userName: "Alice", timestamp: 1_700_000_000_000 },
        timestamp: 1_700_000_000_000,
      },
      {
        type: "update",
        object: { ...baseObject, x: 50, y: 50 },
        version: 43,
        meta: { userId: "alice", userName: "Alice", timestamp: 1_700_000_000_100 },
        timestamp: 1_700_000_000_100,
      },
      {
        type: "delete",
        objectId: baseObject.id,
        version: 44,
        meta: { userId: "alice", userName: "Alice", timestamp: 1_700_000_000_200 },
        timestamp: 1_700_000_000_200,
      },
    ]

    saveQueuedOperations(canvasId, operations)
    const loaded = loadQueuedOperations(canvasId)

    assert.deepEqual(loaded, operations)

    clearQueuedOperations(canvasId)
    assert.deepEqual(loadQueuedOperations(canvasId), [])
  })
})
