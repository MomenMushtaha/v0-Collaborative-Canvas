"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CollaborativeCanvas } from "@/components/collaborative-canvas"
import { Toolbar } from "@/components/toolbar"
import { AiChat } from "@/components/ai-chat"
import { HistoryPanel } from "@/components/history-panel"
import { CommentsPanel } from "@/components/comments-panel"
import type { CanvasObject, UiObstructionSnapshot, UiRect } from "@/lib/types"
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
  const [onBringToFront, setOnBringToFront] = useState<(() => void) | undefined>()
  const [onSendToBack, setOnSendToBack] = useState<(() => void) | undefined>()
  const [onBringForward, setOnBringForward] = useState<(() => void) | undefined>()
  const [onSendBackward, setOnSendBackward] = useState<(() => void) | undefined>()
  const [gridEnabled, setGridEnabled] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [gridSize, setGridSize] = useState(20)
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
  const [viewportSize, setViewportSize] = useState({ width: 1920, height: 1080 })
  const [showHistory, setShowHistory] = useState(false)
  const [pendingHistoryRestore, setPendingHistoryRestore] = useState<CanvasObject[] | null>(null)
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now())
  const [commentMode, setCommentMode] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [lassoMode, setLassoMode] = useState(false)
  const [onSelectAllOfType, setOnSelectAllOfType] = useState<(() => void) | undefined>()
  const [uiObstructionMap, setUiObstructionMap] = useState<Record<string, UiRect>>({})

  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const rectEquals = useCallback((a: UiRect, b: UiRect) => {
    return (
      a.left === b.left &&
      a.top === b.top &&
      a.right === b.right &&
      a.bottom === b.bottom &&
      a.width === b.width &&
      a.height === b.height
    )
  }, [])

  const updateUiObstruction = useCallback(
    (id: string, rect: UiRect | null) => {
      setUiObstructionMap((previous) => {
        if (!rect) {
          if (!(id in previous)) {
            return previous
          }
          const { [id]: _removed, ...rest } = previous
          return rest
        }

        const normalized: UiRect = {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }

        const existing = previous[id]
        if (existing && rectEquals(existing, normalized)) {
          return previous
        }

        return { ...previous, [id]: normalized }
      })
    },
    [rectEquals],
  )

  const uiObstructions: UiObstructionSnapshot[] = useMemo(
    () =>
      Object.entries(uiObstructionMap).map(([id, rect]) => ({
        id,
        ...rect,
      })),
    [uiObstructionMap],
  )

  useEffect(() => {
    const updateViewportSize = () => {
      if (typeof window === "undefined") return

      setViewportSize({
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
      })
    }

    updateViewportSize()
    window.addEventListener("resize", updateViewportSize)

    return () => {
      window.removeEventListener("resize", updateViewportSize)
    }
  }, [])

  useEffect(() => {
    console.log("[v0] [PAGE] onSelectAllOfType state updated:", onSelectAllOfType)
  }, [onSelectAllOfType])

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

  const handleCopy = () => {
    if (selectedObjectIds.length === 0) return
    const selectedObjs = currentObjects.filter((obj) => selectedObjectIds.includes(obj.id))
    // Store in a state that can be accessed by the collaborative canvas
    console.log("[v0] Copy triggered from toolbar for", selectedObjectIds.length, "objects")
  }

  const handlePaste = () => {
    console.log("[v0] Paste triggered from toolbar")
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
    setPendingHistoryRestore(objects)
    setLastSnapshotTime(Date.now())
    console.log("[v0] Restoring history snapshot with", objects.length, "objects")
  }

  const handleHistoryRestoreComplete = useCallback(
    (result: "success" | "error") => {
      setPendingHistoryRestore(null)

      if (result === "success") {
        toast({
          title: "Version restored",
          description: "The canvas has been updated to the selected snapshot.",
        })
      } else {
        toast({
          title: "Restore failed",
          description: "We couldn't apply that snapshot. Please try again.",
          variant: "destructive",
        })
      }
    },
    [toast],
  )

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
          onCopy={handleCopy}
          onPaste={handlePaste}
          onBringToFront={onBringToFront}
          onSendToBack={onSendToBack}
          onBringForward={onBringForward}
          onSendBackward={onSendBackward}
          lassoMode={lassoMode}
          onToggleLassoMode={() => setLassoMode(!lassoMode)}
          onSelectAllOfType={onSelectAllOfType}
          onBoundsChange={(rect) => updateUiObstruction("toolbar", rect)}
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
          gridEnabled={gridEnabled}
          snapEnabled={snapEnabled}
          gridSize={gridSize}
          onGridChange={handleGridChange}
          commentMode={commentMode}
          onCommentCreate={handleCommentCreate}
          comments={comments}
          onBringToFront={setOnBringToFront}
          onSendToBack={setOnSendToBack}
          onBringForward={setOnBringForward}
          onSendBackward={setOnSendBackward}
          lassoMode={lassoMode}
          onSelectAllOfType={setOnSelectAllOfType}
          historyRestore={pendingHistoryRestore}
          onHistoryRestoreComplete={handleHistoryRestoreComplete}
          onOverlayBoundsChange={updateUiObstruction}
        />
      </div>
      <AiChat
        currentObjects={currentObjects}
        selectedObjectIds={selectedObjectIds}
        onOperations={handleOperations}
        userId={user.id}
        userName={user.name}
        canvasId="default"
        viewport={viewport}
        viewportSize={viewportSize}
        uiObstructions={uiObstructions}
        onBoundsChange={(rect) => updateUiObstruction("aiChat", rect)}
      />
      {showHistory && (
        <HistoryPanel
          canvasId="default"
          currentObjects={currentObjects}
          userId={user.id}
          userName={user.name}
          onRestore={handleRestoreHistory}
          onClose={() => setShowHistory(false)}
          onBoundsChange={(rect) => updateUiObstruction("historyPanel", rect)}
        />
      )}
      <CommentsPanel
        canvasId="default"
        userId={user.id}
        onCommentClick={handleCommentClick}
        comments={comments}
        onCommentsChange={handleCommentsChange}
        onBoundsChange={(rect) => updateUiObstruction("commentsPanel", rect)}
      />
    </div>
  )
}
