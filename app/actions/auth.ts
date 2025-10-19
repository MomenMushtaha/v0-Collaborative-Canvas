"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

export async function signInWithGoogle() {
  const cookieStore = await cookies()
  const headersList = await headers()
  const origin = headersList.get("origin") || headersList.get("referer")?.split("/").slice(0, 3).join("/")

  if (!origin) {
    console.error("[v0] Could not determine origin for OAuth redirect")
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
            console.error("[v0] Error setting cookies:", error)
          }
        },
      },
    },
  )

  console.log("[v0] Initiating Google OAuth with redirect to:", `${origin}/auth/callback`)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  })

  if (error) {
    console.error("[v0] Google OAuth error:", error)
    return { error: error.message }
  }

  if (data.url) {
    console.log("[v0] Redirecting to Google OAuth URL")
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}

export async function signInWithGitHub() {
  const cookieStore = await cookies()
  const headersList = await headers()
  const origin = headersList.get("origin") || headersList.get("referer")?.split("/").slice(0, 3).join("/")

  if (!origin) {
    console.error("[v0] Could not determine origin for OAuth redirect")
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
            console.error("[v0] Error setting cookies:", error)
          }
        },
      },
    },
  )

  console.log("[v0] Initiating GitHub OAuth with redirect to:", `${origin}/auth/callback`)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    console.error("[v0] GitHub OAuth error:", error)
    return { error: error.message }
  }

  if (data.url) {
    console.log("[v0] Redirecting to GitHub OAuth URL")
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}
