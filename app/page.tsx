"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default function HomePage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get("error")

    if (errorParam === "already_logged_in") {
      setError("You are already logged in on another device. Please log out from that device first.")
      window.history.replaceState({}, "", "/")
      return
    }

    if (errorParam === "session_creation_failed") {
      setError("Failed to create session. Please try again.")
      window.history.replaceState({}, "", "/")
      return
    }

    if (errorParam) {
      router.push(`/email_confirmed${window.location.search}${window.location.hash}`)
      return
    }

    // Check if user is already logged in
    supabase.auth
      .getUser()
      .then(({ data: { user }, error }) => {
        if (error) {
          return
        }
        if (user) {
          router.push("/canvas")
        }
      })
      .catch((error) => {
        console.error("[v0] Error checking auth on home page:", error)
      })
  }, [router, supabase])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")
    setSuccess("")

    console.log("[v0] Email/password sign in attempt")

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      console.error("[v0] Sign in error:", signInError)
      setError(signInError.message)
      setIsLoading(false)
      return
    }

    if (signInData.user && signInData.session) {
      console.log("[v0] Sign in successful, checking for existing session...")
      const { checkExistingSession, createSession } = await import("@/lib/session-utils")
      const existingSession = await checkExistingSession(supabase, signInData.user.id)

      if (existingSession) {
        console.log("[v0] User already has active session on another device, blocking login")
        await supabase.auth.signOut()
        setError(
          "You are already logged in on another device. Please log out from that device first, or wait a few moments and try again.",
        )
        setIsLoading(false)
        return
      }

      console.log("[v0] Creating new session record...")
      const sessionCreated = await createSession(supabase, signInData.user.id, signInData.session.access_token)

      if (!sessionCreated) {
        console.error("[v0] Failed to create session record")
        await supabase.auth.signOut()
        setError("Failed to create session. Please try again.")
        setIsLoading(false)
        return
      }

      console.log("[v0] Session created, redirecting to canvas")
      router.push("/canvas")
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")
    setSuccess("")

    const redirectUrl = `${window.location.origin}/auth/callback`

    const { data: existingUser } = await supabase
      .from("user_presence")
      .select("user_id")
      .eq("user_id", (await supabase.auth.getSession()).data.session?.user.id || "")
      .single()

    const { data: signInCheck } = await supabase.auth.signInWithPassword({
      email,
      password: "dummy-password-check",
    })

    if (signInCheck?.user) {
      setError("This email is already registered. Please sign in instead or use a different email.")
      setIsLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
        },
        emailRedirectTo: redirectUrl,
      },
    })

    if (error) {
      if (
        error.message.toLowerCase().includes("already registered") ||
        error.message.toLowerCase().includes("already exists") ||
        error.message.toLowerCase().includes("user already registered")
      ) {
        setError("This email is already registered. Please sign in instead or use a different email.")
      } else {
        setError(error.message)
      }
      setIsLoading(false)
    } else if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError("This email is already registered. Please sign in instead or use a different email.")
      setIsLoading(false)
    } else {
      setSuccess("Check your email to confirm your account!")
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">CollabCanvas</CardTitle>
          <CardDescription>Real-time collaborative design tool</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {success && <p className="text-sm text-green-600">{success}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Signing up..." : "Sign Up"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
