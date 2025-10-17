"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CollaborativeCanvas } from "@/components/collaborative-canvas"
import { Toolbar } from "@/components/toolbar"
import { AiChat } from "@/components/ai-chat"
import type { CanvasObject } from "@/lib/types"

export default function CanvasPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [aiOperations, setAiOperations] = useState<any[]>([])
  const [currentObjects, setCurrentObjects] = useState<CanvasObject[]>([])
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const router = useRouter()
  const supabase = createClient()

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

  const handleOperations = (operations: any[], queueItemId: string) => {
    console.log("[v0] AI operations received:", operations, "Queue ID:", queueItemId)
    setAiOperations(operations)
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
        <CollaborativeCanvas
          canvasId="default"
          userId={user.id}
          userName={user.name}
          aiOperations={aiOperations}
          onAiOperationsProcessed={() => setAiOperations([])}
          onObjectsChange={setCurrentObjects}
          onSelectionChange={setSelectedObjectIds}
        />
      </div>
      <AiChat
        currentObjects={currentObjects}
        selectedObjectIds={selectedObjectIds}
        onOperations={handleOperations}
        userId={user.id}
        userName={user.name}
        canvasId="default"
      />
    </div>
  )
}
