"use server"

import { createServerClient } from "@supabase/ssr"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

async function getOrigin(): Promise<string> {
  const headersList = await headers()

  // Try multiple methods to get the origin
  const origin = headersList.get("x-forwarded-host")
    ? `https://${headersList.get("x-forwarded-host")}`
    : headersList.get("origin") ||
      headersList.get("referer")?.split("/").slice(0, 3).join("/") ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      ""

  console.log("[v0] Detected origin:", origin)
  console.log("[v0] Headers - x-forwarded-host:", headersList.get("x-forwarded-host"))
  console.log("[v0] Headers - origin:", headersList.get("origin"))
  console.log("[v0] Headers - referer:", headersList.get("referer"))
  console.log("[v0] ENV - NEXT_PUBLIC_SITE_URL:", process.env.NEXT_PUBLIC_SITE_URL)

  return origin
}

export async function signInWithGoogle() {
  const cookieStore = await cookies()
  const origin = await getOrigin()

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

  const redirectUrl = `${origin}/auth/callback`
  console.log("[v0] Initiating Google OAuth with redirect to:", redirectUrl)

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
    console.error("[v0] Google OAuth error:", error)
    return { error: error.message }
  }

  if (data.url) {
    console.log("[v0] Redirecting to Google OAuth URL:", data.url)
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}

export async function signInWithGitHub() {
  const cookieStore = await cookies()
  const origin = await getOrigin()

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

  const redirectUrl = `${origin}/auth/callback`
  console.log("[v0] Initiating GitHub OAuth with redirect to:", redirectUrl)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: redirectUrl,
    },
  })

  if (error) {
    console.error("[v0] GitHub OAuth error:", error)
    return { error: error.message }
  }

  if (data.url) {
    console.log("[v0] Redirecting to GitHub OAuth URL:", data.url)
    redirect(data.url)
  }

  return { error: "No redirect URL received from Supabase" }
}
