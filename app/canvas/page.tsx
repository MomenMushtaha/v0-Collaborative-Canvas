"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { CollaborativeCanvas } from "@/components/collaborative-canvas"
import { Toolbar } from "@/components/toolbar"

export default function CanvasPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()
  const supabase = getSupabaseBrowserClient()

  useEffect(() => {
    // Check authentication
    supabase.auth.getUser().then(({ data: { user: authUser } }) => {
      if (!authUser) {
        router.push("/")
      } else {
        setUser({
          id: authUser.id,
          name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Anonymous",
        })
        setIsLoading(false)
      }
    })
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      <Toolbar userName={user.name} onSignOut={handleSignOut} />
      <div className="flex-1">
        <CollaborativeCanvas canvasId="default" userId={user.id} userName={user.name} />
      </div>
    </div>
  )
}
