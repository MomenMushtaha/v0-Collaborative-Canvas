"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CollaborativeCanvas } from "@/components/collaborative-canvas"
import { Toolbar } from "@/components/toolbar"
import { AiChat } from "@/components/ai-chat"
import { HistoryPanel } from "@/components/history-panel"
import { CommentsPanel } from "@/components/comments-panel"
import type { CanvasObject } from "@/lib/types"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"
import { exportCanvas } from "@/lib/export-utils"
import { saveHistorySnapshot } from "@/lib/history-utils"
import { loadComments, createComment, subscribeToComments, type Comment } from "@/lib/comments-utils"
import { useToast } from "@/hooks/use-toast"

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
  const [onGroup, setOnGroup] = useState<(() => void) | undefined>()
  const [onUngroup, setOnUngroup] = useState<(() => void) | undefined>()
  const [hasGroupedSelection, setHasGroupedSelection] = useState(false)
  const [gridEnabled, setGridEnabled] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [gridSize, setGridSize] = useState(20)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [showHistory, setShowHistory] = useState(false)
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now())
  const [commentMode, setCommentMode] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

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

  useEffect(() => {
    if (!user) return

    const loadInitialComments = async () => {
      const loadedComments = await loadComments("default")
      setComments(loadedComments)
    }

    loadInitialComments()

    const unsubscribe = subscribeToComments("default", (newComment) => {
      setComments((prev) => [newComment, ...prev])
    })

    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!user || currentObjects.length === 0) return

    const now = Date.now()
    const timeSinceLastSnapshot = now - lastSnapshotTime

    // Save snapshot if 2 minutes have passed and there are objects
    if (timeSinceLastSnapshot > 120000) {
      saveHistorySnapshot("default", currentObjects, user.id, user.name, "Auto-save").catch((error) => {
        console.error("[v0] Failed to auto-save history:", error)
      })
      setLastSnapshotTime(now)
    }
  }, [currentObjects, user, lastSnapshotTime])

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
      viewport: viewport,
      canvasWidth: typeof window !== "undefined" ? window.innerWidth : 1920,
      canvasHeight: typeof window !== "undefined" ? window.innerHeight : 1080,
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
      viewport: viewport,
      canvasWidth: typeof window !== "undefined" ? window.innerWidth : 1920,
      canvasHeight: typeof window !== "undefined" ? window.innerHeight : 1080,
    })
  }

  const handleGridChange = (enabled: boolean, snap: boolean, size: number) => {
    setGridEnabled(enabled)
    setSnapEnabled(snap)
    setGridSize(size)
    console.log("[v0] Grid settings changed:", { enabled, snap, size })
  }

  const handleRestoreHistory = (objects: CanvasObject[]) => {
    setCurrentObjects(objects)
    console.log("[v0] Restored history snapshot with", objects.length, "objects")
  }

  const handleCommentCreate = async (x: number, y: number, content: string) => {
    if (!user) return

    const comment = await createComment("default", x, y, content, user.id, user.name)
    if (comment) {
      setComments((prev) => [comment, ...prev])
      toast({
        title: "Comment added",
        description: "Your comment has been added to the canvas",
      })
    }
  }

  const handleCommentClick = (x: number, y: number) => {
    const canvasWidth = typeof window !== "undefined" ? window.innerWidth : 1920
    const canvasHeight = typeof window !== "undefined" ? window.innerHeight : 1080

    setViewport({
      x: canvasWidth / 2 - x * viewport.zoom,
      y: canvasHeight / 2 - y * viewport.zoom,
      zoom: viewport.zoom,
    })
  }

  const handleCommentsChange = async () => {
    const loadedComments = await loadComments("default")
    setComments(loadedComments)
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
          onShowHistory={() => setShowHistory(true)}
          commentMode={commentMode}
          onToggleCommentMode={() => setCommentMode(!commentMode)}
          onGroup={onGroup}
          onUngroup={onUngroup}
          hasGroupedSelection={hasGroupedSelection}
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
          viewport={viewport}
          onViewportChange={setViewport}
          onUndo={setOnUndo}
          onRedo={setOnRedo}
          canUndo={setCanUndo}
          canRedo={setCanRedo}
          onAlign={setOnAlign}
          onDistribute={setOnDistribute}
          onGroup={setOnGroup}
          onUngroup={setOnUngroup}
          hasGroupedSelection={setHasGroupedSelection}
          gridEnabled={gridEnabled}
          snapEnabled={snapEnabled}
          gridSize={gridSize}
          onGridChange={handleGridChange}
          commentMode={commentMode}
          onCommentCreate={handleCommentCreate}
          comments={comments}
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
      {showHistory && (
        <HistoryPanel canvasId="default" onRestore={handleRestoreHistory} onClose={() => setShowHistory(false)} />
      )}
      <CommentsPanel
        canvasId="default"
        userId={user.id}
        onCommentClick={handleCommentClick}
        comments={comments}
        onCommentsChange={handleCommentsChange}
      />
    </div>
  )
}
