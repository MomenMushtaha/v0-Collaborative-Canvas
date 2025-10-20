"use client"

import { useCallback, useEffect, useState } from "react"
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
import { deleteSession } from "@/lib/session-utils"
import { useAIQueue, type AIQueueItem } from "@/hooks/use-ai-queue"

export default function CanvasPage() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [aiOperations, setAiOperations] = useState<any[]>([])
  const [lastQueueItemId, setLastQueueItemId] = useState<string | null>(null)
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
  const [showHistory, setShowHistory] = useState(false)
  const [pendingHistoryRestore, setPendingHistoryRestore] = useState<CanvasObject[] | null>(null)
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now())
  const [commentMode, setCommentMode] = useState(false)
  const [comments, setComments] = useState<Comment[]>([])
  const [lassoMode, setLassoMode] = useState(false)
  const [onSelectAllOfType, setOnSelectAllOfType] = useState<(() => void) | undefined>()

  const [presencePanelCollapsed, setPresencePanelCollapsed] = useState(false)
  const [layersPanelCollapsed, setLayersPanelCollapsed] = useState(false)
  const [stylePanelCollapsed, setStylePanelCollapsed] = useState(false)

  const PANEL_SPACING = 16 // Gap between panels
  const COLLAPSED_HEIGHT = 48 // Height of collapsed panel button
  const PRESENCE_EXPANDED_HEIGHT = 260
  const LAYERS_EXPANDED_HEIGHT = 280

  const presenceTop = 80 // Below toolbar
  const layersTop = presenceTop + (presencePanelCollapsed ? COLLAPSED_HEIGHT : PRESENCE_EXPANDED_HEIGHT) + PANEL_SPACING
  const styleTop = layersTop + (layersPanelCollapsed ? COLLAPSED_HEIGHT : LAYERS_EXPANDED_HEIGHT) + PANEL_SPACING

  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    // Check authentication
    supabase.auth
      .getUser()
      .then(({ data: { user: authUser }, error }) => {
        if (error || !authUser) {
          console.warn("[v0] Auth error or no user:", error)
          router.push("/")
        } else {
          setUser({
            id: authUser.id,
            name: authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Anonymous",
          })
          setIsLoading(false)
        }
      })
      .catch((error) => {
        console.error("[v0] Error checking auth:", error)
        router.push("/")
      })
  }, [router, supabase])

  useEffect(() => {
    if (!user) return

    const handleBeforeUnload = () => {
      console.log("[v0] Window closing, logging out user:", user.id)

      // Use sendBeacon for reliable logout during page unload
      // This ensures the request completes even as the page is closing
      const logoutData = JSON.stringify({ userId: user.id })
      const blob = new Blob([logoutData], { type: "application/json" })

      // Try to send logout request via beacon (most reliable)
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/logout", blob)
      }

      // Clear Supabase auth locally to ensure session removal even if the network call fails
      void supabase.auth.signOut({ scope: "local" }).catch((error) => {
        console.error("[v0] Local sign out failed during unload:", error)
      })

      try {
        const storageKey = (supabase.auth as unknown as { storageKey?: string }).storageKey

        if (storageKey && typeof window !== "undefined") {
          window.localStorage.removeItem(storageKey)
          window.sessionStorage.removeItem(storageKey)
        }
      } catch (storageError) {
        console.error("[v0] Failed to clear Supabase storage key:", storageError)
      }

      // Also delete session synchronously as backup
      void deleteSession(supabase, user.id)
    }

    // Listen for multiple unload events to catch all cases
    window.addEventListener("beforeunload", handleBeforeUnload)
    window.addEventListener("pagehide", handleBeforeUnload)

    // Cleanup listeners on component unmount
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      window.removeEventListener("pagehide", handleBeforeUnload)
    }
  }, [user, supabase])

  useEffect(() => {
    if (!user) return

    const loadInitialComments = async () => {
      const loadedComments = await loadComments(supabase, "default")
      setComments(loadedComments)
    }

    loadInitialComments()

    const unsubscribe = subscribeToComments(supabase, "default", (newComment) => {
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
    console.log("[v0] Sign out initiated for user:", user?.id)

    if (user) {
      const sessionDeleted = await deleteSession(supabase, user.id)
      console.log("[v0] Session deletion result:", sessionDeleted)
    }

    await supabase.auth.signOut()
    console.log("[v0] Supabase auth sign out complete")
    router.push("/")
  }

  const handleCopy = () => {
    if (selectedObjectIds.length === 0) return
    const selectedObjs = currentObjects.filter((obj) => selectedObjectIds.includes(obj.id))
    console.log("[v0] Copy triggered from toolbar for", selectedObjectIds.length, "objects")
  }

  const handlePaste = () => {
    console.log("[v0] Paste triggered from toolbar")
  }

  const handleQueueOperations = useCallback(
    (operations: any[], queueItem: AIQueueItem) => {
      console.log(
        "[v0] Remote AI operations received:",
        operations.length,
        "from queue item",
        queueItem.id,
        "by",
        queueItem.user_name,
      )
      setLastQueueItemId(queueItem.id)
      setAiOperations(operations)
    },
    [],
  )

  const { markOperationsProcessed } = useAIQueue({
    canvasId: "default",
    userId: user?.id ?? "",
    onOperations: handleQueueOperations,
  })

  const handleOperations = useCallback(
    (operations: any[], queueItemId: string) => {
      console.log("[v0] AI operations received:", operations, "Queue ID:", queueItemId)
      setAiOperations(operations)
      if (queueItemId) {
        setLastQueueItemId(queueItemId)
        markOperationsProcessed(queueItemId)
      }
    },
    [markOperationsProcessed],
  )

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

    const comment = await createComment(supabase, "default", x, y, content, user.id, user.name)
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
    const loadedComments = await loadComments(supabase, "default")
    setComments(loadedComments)
  }

  const handleCommentModeChange = useCallback((enabled: boolean) => {
    setCommentMode(enabled)
    console.log("[v0] Comment mode changed to:", enabled)
  }, [])

  const usableCanvasDimensions = {
    leftOffset: 300,
    rightOffset: 400,
    topOffset: 80,
    bottomOffset: 200,
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
          onShowHistory={() => setShowHistory(!showHistory)}
          isHistoryOpen={showHistory}
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
        />
      </div>
      <div className="h-full w-full">
        <CollaborativeCanvas
          canvasId="default"
          userId={user.id}
          userName={user.name}
          aiOperations={aiOperations}
          onAiOperationsProcessed={() => {
            if (lastQueueItemId) {
              markOperationsProcessed(lastQueueItemId)
              setLastQueueItemId(null)
            }
            setAiOperations([])
          }}
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
          onCommentModeChange={handleCommentModeChange}
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
        usableCanvasDimensions={usableCanvasDimensions}
      />
      {showHistory && (
        <HistoryPanel
          canvasId="default"
          currentObjects={currentObjects}
          userId={user.id}
          userName={user.name}
          onRestore={handleRestoreHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
      <CommentsPanel
        canvasId="default"
        userId={user.id}
        onCommentClick={handleCommentClick}
        comments={comments}
        onCommentsChange={handleCommentsChange}
        supabase={supabase}
      />
    </div>
  )
}
