"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CollaborativeCanvas } from "@/components/collaborative-canvas"
import { Toolbar } from "@/components/toolbar"
import { AiChat } from "@/components/ai-chat"
import type { CanvasObject } from "@/lib/types"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"
import { exportCanvas } from "@/lib/export-utils"

export default function CanvasPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [aiOperations, setAiOperations] = useState<any[]>([])
  const [currentObjects, setCurrentObjects] = useState<CanvasObject[]>([])
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [onUndo, setOnUndo] = useState<(() => void) | undefined>()
  const [onRedo, setOnRedo] = useState<(() => void) | undefined>()
  const [onAlign, setOnAlign] = useState<((type: AlignmentType) => void) | undefined>()
  const [onDistribute, setOnDistribute] = useState<((type: DistributeType) => void) | undefined>()
  const [gridEnabled, setGridEnabled] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [gridSize, setGridSize] = useState(20)
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

  const handleExportPNG = () => {
    const objectsToExport =
      selectedObjectIds.length > 0 ? currentObjects.filter((obj) => selectedObjectIds.includes(obj.id)) : currentObjects

    if (objectsToExport.length === 0) {
      console.warn("[v0] No objects to export")
      return
    }

    exportCanvas({
      format: "png",
      objects: objectsToExport,
      backgroundColor: "#ffffff",
      scale: 2,
    })
  }

  const handleExportSVG = () => {
    const objectsToExport =
      selectedObjectIds.length > 0 ? currentObjects.filter((obj) => selectedObjectIds.includes(obj.id)) : currentObjects

    if (objectsToExport.length === 0) {
      console.warn("[v0] No objects to export")
      return
    }

    exportCanvas({
      format: "svg",
      objects: objectsToExport,
      backgroundColor: "#ffffff",
    })
  }

  const handleGridChange = (enabled: boolean, snap: boolean, size: number) => {
    setGridEnabled(enabled)
    setSnapEnabled(snap)
    setGridSize(size)
    console.log("[v0] Grid settings changed:", { enabled, snap, size })
  }

  if (isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div className="absolute left-0 right-0 top-0 z-10">
        <Toolbar
          userName={user.name}
          onSignOut={handleSignOut}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          selectedCount={selectedObjectIds.length}
          onAlign={onAlign}
          onDistribute={onDistribute}
          onExportPNG={handleExportPNG}
          onExportSVG={handleExportSVG}
          gridEnabled={gridEnabled}
          snapEnabled={snapEnabled}
          gridSize={gridSize}
          onGridChange={handleGridChange}
        />
      </div>
      <div className="h-full w-full">
        <CollaborativeCanvas
          canvasId="default"
          userId={user.id}
          userName={user.name}
          aiOperations={aiOperations}
          onAiOperationsProcessed={() => setAiOperations([])}
          onObjectsChange={setCurrentObjects}
          onSelectionChange={setSelectedObjectIds}
          onUndo={setOnUndo}
          onRedo={setOnRedo}
          canUndo={setCanUndo}
          canRedo={setCanRedo}
          onAlign={setOnAlign}
          onDistribute={setOnDistribute}
          gridEnabled={gridEnabled}
          snapEnabled={snapEnabled}
          gridSize={gridSize}
          onGridChange={handleGridChange}
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
