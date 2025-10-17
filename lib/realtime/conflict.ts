export interface ConflictDecisionInput {
  currentVersion: number | undefined
  incomingVersion: number
  currentUserId?: string
  incomingUserId?: string
  currentTimestamp?: number
  incomingTimestamp?: number
}

export function shouldApplyRemoteUpdate({
  currentVersion,
  incomingVersion,
  currentUserId,
  incomingUserId,
  currentTimestamp,
  incomingTimestamp,
}: ConflictDecisionInput) {
  if (currentVersion === undefined) {
    return true
  }

  if (incomingVersion > currentVersion) {
    return true
  }

  if (incomingVersion < currentVersion) {
    return false
  }

  // Versions are equal. Fall back to timestamp comparison.
  if (incomingTimestamp !== undefined && currentTimestamp !== undefined) {
    if (incomingTimestamp > currentTimestamp) {
      return true
    }
    if (incomingTimestamp < currentTimestamp) {
      return false
    }
  }

  // Final deterministic tie-breaker on user id
  if (incomingUserId && currentUserId && incomingUserId !== currentUserId) {
    return incomingUserId > currentUserId
  }

  return false
}

export interface LastEditorMeta {
  userId: string
  userName: string
  timestamp: number
}

export function toSerializableMap<T extends { [key: string]: any }>(map: Map<string, T>) {
  return Object.fromEntries(map.entries())
}

export function mapFromObject<T>(obj: Record<string, T> | undefined) {
  if (!obj) return new Map<string, T>()
  return new Map(Object.entries(obj))
}
