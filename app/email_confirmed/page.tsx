"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

export default function EmailConfirmedPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    // Check for error parameters in URL
    const error = searchParams.get("error")
    const errorCode = searchParams.get("error_code")
    const errorDescription = searchParams.get("error_description")

    if (error) {
      setStatus("error")

      // Provide user-friendly error messages
      if (errorCode === "otp_expired") {
        setErrorMessage("This confirmation link has expired. Please sign up again to receive a new confirmation email.")
      } else {
        setErrorMessage(errorDescription || "An error occurred during email confirmation. Please try signing up again.")
      }
    } else {
      // Success case
      setStatus("success")

      // Redirect to canvas after 3 seconds
      setTimeout(() => {
        router.push("/canvas")
      }, 3000)
    }
  }, [searchParams, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">CollabCanvas</CardTitle>
          <CardDescription>Email Confirmation</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 py-8">
          {status === "loading" && (
            <>
              <Loader2 className="h-16 w-16 animate-spin text-primary" />
              <div className="text-center">
                <h2 className="text-xl font-semibold">Verifying your email...</h2>
                <p className="text-sm text-muted-foreground mt-2">Please wait a moment</p>
              </div>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="h-16 w-16 text-green-500" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-green-600">Email Confirmed!</h2>
                <p className="text-sm text-muted-foreground mt-2">Your account has been successfully verified.</p>
                <p className="text-sm text-muted-foreground mt-1">Redirecting to canvas in 3 seconds...</p>
              </div>
              <Button onClick={() => router.push("/canvas")} className="w-full">
                Go to Canvas Now
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="h-16 w-16 text-destructive" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-destructive">Confirmation Failed</h2>
                <p className="text-sm text-muted-foreground mt-4 max-w-sm">{errorMessage}</p>
              </div>
              <Button onClick={() => router.push("/")} className="w-full">
                Return to Sign In
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
