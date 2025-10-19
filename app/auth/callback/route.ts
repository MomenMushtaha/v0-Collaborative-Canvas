import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { checkExistingSession, createSession } from "@/lib/session-utils"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")
  const origin = requestUrl.origin

  console.log("[v0] Auth callback triggered")
  console.log("[v0] Code present:", !!code)
  console.log("[v0] Error:", error)
  console.log("[v0] Error description:", errorDescription)

  if (error) {
    console.error("[v0] OAuth provider error:", error, errorDescription)
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(errorDescription || error)}`)
  }

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
            } catch (error) {
              console.error("[v0] Error setting cookies in callback:", error)
            }
          },
        },
      },
    )

    console.log("[v0] Exchanging code for session...")
    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      console.error("[v0] Error exchanging code for session:", exchangeError)
      return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(exchangeError.message)}`)
    }

    if (data.user && data.session) {
      console.log("[v0] Session obtained for user:", data.user.id)
      console.log("[v0] User email:", data.user.email)
      console.log("[v0] Auth provider:", data.user.app_metadata.provider)

      const existingSession = await checkExistingSession(supabase, data.user.id)

      if (existingSession) {
        console.log("[v0] User already has active session, blocking login")
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=already_logged_in`)
      }

      console.log("[v0] Creating new session record...")
      const sessionCreated = await createSession(supabase, data.user.id, data.session.access_token)

      if (!sessionCreated) {
        console.error("[v0] Failed to create session record")
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=session_creation_failed`)
      }

      console.log("[v0] OAuth session created successfully, redirecting to canvas")
      return NextResponse.redirect(`${origin}/canvas`)
    }
  }

  console.log("[v0] No code or session data, redirecting to home")
  return NextResponse.redirect(`${origin}/?error=no_code`)
}
