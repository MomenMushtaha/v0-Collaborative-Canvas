import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId } = body

    console.log("[v0] Logout API called for user:", userId)

    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 })
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
            } catch {
              // Ignore cookie setting errors in API routes
            }
          },
        },
      },
    )

    // Delete session from user_sessions table
    const { error: deleteError } = await supabase.from("user_sessions").delete().eq("user_id", userId)

    if (deleteError) {
      console.error("[v0] Error deleting session:", deleteError)
      return NextResponse.json({ error: "Failed to delete session" }, { status: 500 })
    }

    console.log("[v0] Session deleted successfully for user:", userId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Logout API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
