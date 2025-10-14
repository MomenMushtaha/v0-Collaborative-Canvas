"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

export default function ConfirmPage() {
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const error = searchParams.get("error")
    const errorCode = searchParams.get("error_code")
    const errorDescription = searchParams.get("error_description")

    if (error) {
      setStatus("error")

      // Provide user-friendly error messages based on error code
      if (errorCode === "otp_expired") {
        setErrorMessage("Your confirmation link has expired. Please request a new one by signing up again.")
      } else {
        setErrorMessage(errorDescription || "An error occurred during email confirmation.")
      }
      return
    }

    // Check if user is authenticated after email confirmation
    const checkAuth = async () => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError) {
        setStatus("error")
        setErrorMessage("Unable to verify your email. Please try signing in.")
        return
      }

      if (user) {
        setStatus("success")
        // Redirect to canvas after 2 seconds
        setTimeout(() => {
          router.push("/canvas")
        }, 2000)
      } else {
        setStatus("error")
        setErrorMessage("Unable to confirm your email. Please try signing in.")
      }
    }

    checkAuth()
  }, [router, supabase, searchParams])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">CollabCanvas</CardTitle>
          <CardDescription>Email Confirmation</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === "loading" && (
            <>
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <p className="text-center text-muted-foreground">Confirming your email...</p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <div className="text-center space-y-2">
                <p className="text-xl font-semibold">Email Confirmed!</p>
                <p className="text-sm text-muted-foreground">Redirecting you to the canvas...</p>
              </div>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="h-16 w-16 text-destructive" />
              <div className="text-center space-y-4">
                <p className="text-xl font-semibold text-destructive">Confirmation Failed</p>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
                <Button onClick={() => router.push("/")} className="w-full">
                  Back to Sign In
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
