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

  if (error) {
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
            } catch {
              // Cookie setting can fail in certain contexts
            }
          },
        },
      },
    )

    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (exchangeError) {
      return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(exchangeError.message)}`)
    }

    if (data.user && data.session) {
      const existingSession = await checkExistingSession(supabase, data.user.id)

      if (existingSession) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=already_logged_in`)
      }

      const sessionCreated = await createSession(supabase, data.user.id, data.session.access_token)

      if (!sessionCreated) {
        await supabase.auth.signOut()
        return NextResponse.redirect(`${origin}/?error=session_creation_failed`)
      }

      return NextResponse.redirect(`${origin}/canvas`)
    }
  }

  return NextResponse.redirect(`${origin}/?error=no_code`)
}
