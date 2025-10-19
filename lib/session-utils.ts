import type { SupabaseClient } from "@supabase/supabase-js"

export interface UserSession {
  id: string
  user_id: string
  session_id: string
  device_info: string | null
  ip_address: string | null
  created_at: string
  last_activity: string
}

/**
 * Get device information for session tracking
 */
export function getDeviceInfo(): string {
  if (typeof window === "undefined") return "Server"

  const userAgent = window.navigator.userAgent
  const platform = window.navigator.platform

  return `${platform} - ${userAgent.substring(0, 100)}`
}

/**
 * Check if user has an active session
 */
export async function checkExistingSession(supabase: SupabaseClient, userId: string): Promise<UserSession | null> {
  console.log("[v0] Checking for existing session for user:", userId)

  const { data, error } = await supabase.from("user_sessions").select("*").eq("user_id", userId).single()

  if (error) {
    if (error.code === "PGRST116") {
      // No rows returned - no existing session
      console.log("[v0] No existing session found")
      return null
    }
    console.error("[v0] Error checking existing session:", error)
    return null
  }

  if (data) {
    const isValid = await isSessionStillValid(supabase, data.session_id)
    if (!isValid) {
      console.log("[v0] Found stale session, deleting it")
      // Session is stale (JWT expired or invalid), delete it
      await supabase.from("user_sessions").delete().eq("id", data.id)
      return null
    }
  }

  console.log("[v0] Found existing session:", data)
  return data
}

/**
 * Check if a JWT session token is still valid by verifying with Supabase
 */
async function isSessionStillValid(supabase: SupabaseClient, sessionId: string): Promise<boolean> {
  try {
    // This ensures the session actually exists in Supabase's auth system
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      console.log("[v0] Error verifying session with Supabase:", error.message)
      return false
    }

    // Check if the session exists and matches the stored session ID
    if (!data.session || data.session.access_token !== sessionId) {
      console.log("[v0] Session not found in Supabase auth or token mismatch")
      return false
    }

    // Additional check: verify the session hasn't expired
    const expiresAt = data.session.expires_at
    if (expiresAt && Date.now() / 1000 >= expiresAt) {
      console.log("[v0] Session has expired")
      return false
    }

    console.log("[v0] Session is valid in Supabase auth")
    return true
  } catch (error) {
    console.error("[v0] Error validating session with Supabase:", error)
    return false
  }
}

/**
 * Create a new session record
 */
export async function createSession(supabase: SupabaseClient, userId: string, sessionId: string): Promise<boolean> {
  console.log("[v0] Creating new session for user:", userId)

  const deviceInfo = getDeviceInfo()

  // First, delete any existing sessions for this user
  await supabase.from("user_sessions").delete().eq("user_id", userId)

  // Then create the new session
  const { error } = await supabase.from("user_sessions").insert({
    user_id: userId,
    session_id: sessionId,
    device_info: deviceInfo,
    ip_address: null, // Could be populated from request headers in API route
    last_activity: new Date().toISOString(),
  })

  if (error) {
    console.error("[v0] Error creating session:", error)
    return false
  }

  console.log("[v0] Session created successfully")
  return true
}

/**
 * Update session activity timestamp
 */
export async function updateSessionActivity(supabase: SupabaseClient, sessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from("user_sessions")
    .update({ last_activity: new Date().toISOString() })
    .eq("session_id", sessionId)

  if (error) {
    console.error("[v0] Error updating session activity:", error)
    return false
  }

  return true
}

/**
 * Delete a session record
 */
export async function deleteSession(supabase: SupabaseClient, userId: string): Promise<boolean> {
  console.log("[v0] Deleting session for user:", userId)

  const { error } = await supabase.from("user_sessions").delete().eq("user_id", userId)

  if (error) {
    console.error("[v0] Error deleting session:", error)
    return false
  }

  console.log("[v0] Session deleted successfully")
  return true
}

/**
 * Validate that the current session matches the stored session
 */
export async function validateSession(
  supabase: SupabaseClient,
  userId: string,
  currentSessionId: string,
): Promise<boolean> {
  const existingSession = await checkExistingSession(supabase, userId)

  if (!existingSession) {
    console.log("[v0] No session found for user")
    return false
  }

  if (existingSession.session_id !== currentSessionId) {
    console.log("[v0] Session ID mismatch - user logged in elsewhere")
    return false
  }

  // Update activity timestamp
  await updateSessionActivity(supabase, currentSessionId)

  return true
}
