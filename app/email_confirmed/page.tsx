"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

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
    }
  }, [searchParams, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {status === "loading" && (
        <div className="flex flex-col items-center gap-6">
          <Loader2 className="h-16 w-16 animate-spin text-primary" />
          <div className="text-center">
            <h2 className="text-xl font-semibold">Verifying your email...</h2>
            <p className="text-sm text-muted-foreground mt-2">Please wait a moment</p>
          </div>
        </div>
      )}

      {status === "success" && (
        <div className="flex flex-col items-center gap-6 max-w-md text-center">
          <div className="rounded-full border-4 border-green-500 p-4">
            <CheckCircle2 className="h-12 w-12 text-green-500" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Email address confirmed</h1>
          <p className="text-muted-foreground">
            You have successfully confirmed your email address. Please use your email address to log in.
          </p>
          <Button onClick={() => router.push("/canvas")} className="bg-green-500 hover:bg-green-600 text-white px-8">
            Return to Dashboard
          </Button>
        </div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-6 max-w-md text-center">
          <div className="rounded-full border-4 border-destructive p-4">
            <XCircle className="h-12 w-12 text-destructive" strokeWidth={3} />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Confirmation Failed</h1>
          <p className="text-muted-foreground">{errorMessage}</p>
          <Button onClick={() => router.push("/")} className="px-8">
            Return to Sign In
          </Button>
        </div>
      )}
    </div>
  )
}
