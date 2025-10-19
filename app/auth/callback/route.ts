import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkExistingSession, createSession } from "@/lib/session-utils"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const origin = requestUrl.origin

  console.log("[v0] Auth callback triggered with code:", code ? "present" : "missing")

  if (code) {
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
              // The `setAll` method was called from a Server Component.
              // This can be ignored if you have middleware refreshing
              // user sessions.
            }
          },
        },
      },
    )

    console.log("[v0] Exchanging code for session...")
    // Exchange the code for a session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error("[v0] Error exchanging code for session:", error)
      return NextResponse.redirect(`${origin}/?error=auth_failed`)
    }

    if (data.user && data.session) {
      console.log("[v0] Session obtained for user:", data.user.id)

      const existingSession = await checkExistingSession(supabase, data.user.id)

      if (existingSession) {
        console.log("[v0] User already has active session, blocking login")
        // User is already logged in on another device
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=already_logged_in`)
      }

      // Create new session record
      console.log("[v0] Creating new session record...")
      const sessionCreated = await createSession(supabase, data.user.id, data.session.access_token)

      if (!sessionCreated) {
        console.error("[v0] Failed to create session record")
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=session_creation_failed`)
      }

      console.log("[v0] Session created, redirecting to email_confirmed")
      return NextResponse.redirect(`${origin}/email_confirmed`)
    }
  }

  console.log("[v0] No code or session data, redirecting to email_confirmed")
  return NextResponse.redirect(`${origin}/email_confirmed${requestUrl.search}`)
}
