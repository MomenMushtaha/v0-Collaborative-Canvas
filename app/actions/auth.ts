"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

async function getOrigin(): Promise<string> {
  const headersList = await headers()

  const forwardedHost = headersList.get("x-forwarded-host")
  if (forwardedHost) {
    return `https://${forwardedHost}`
  }

  const origin = headersList.get("origin")
  if (origin) {
    return origin
  }

  return process.env.NEXT_PUBLIC_SITE_URL || ""
}

export async function signInWithGoogle() {
  const cookieStore = await cookies()
  const origin = await getOrigin()

  if (!origin) {
    return { error: "Could not determine origin" }
  }

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
            // Cookie setting can fail in certain contexts
          }
        },
      },
    },
  )

  const redirectUrl = `${origin}/auth/callback`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  })

  if (error) {
    return { error: error.message }
  }

  if (data.url) {
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}

export async function signInWithGitHub() {
  const cookieStore = await cookies()
  const origin = await getOrigin()

  if (!origin) {
    return { error: "Could not determine origin" }
  }

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
            // Cookie setting can fail in certain contexts
          }
        },
      },
    },
  )

  const redirectUrl = `${origin}/auth/callback`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: redirectUrl,
    },
  })

  if (error) {
    return { error: error.message }
  }

  if (data.url) {
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}
