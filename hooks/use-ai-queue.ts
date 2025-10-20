"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserClient } from "@/lib/supabase/client"

export interface AIQueueItem {
  id: string
  canvas_id: string
  user_id: string
  user_name: string
  status: "pending" | "processing" | "completed" | "failed"
  prompt: string
  operations?: any[]
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

interface UseAIQueueProps {
  canvasId: string
  userId: string
  onOperations?: (operations: any[], queueItem: AIQueueItem) => void
}

export function useAIQueue({ canvasId, userId, onOperations }: UseAIQueueProps) {
  const [queue, setQueue] = useState<AIQueueItem[]>([])
  const [isAIWorking, setIsAIWorking] = useState(false)
  const [currentOperation, setCurrentOperation] = useState<AIQueueItem | null>(null)
  const processedQueueItemsRef = useRef<Set<string>>(new Set())
  const onOperationsRef = useRef<UseAIQueueProps["onOperations"]>()
  const currentOperationRef = useRef<AIQueueItem | null>(null)

  useEffect(() => {
    onOperationsRef.current = onOperations
  }, [onOperations])

  useEffect(() => {
    currentOperationRef.current = currentOperation
  }, [currentOperation])

  const markOperationsProcessed = useCallback((queueItemId?: string | null) => {
    if (!queueItemId) return
    processedQueueItemsRef.current.add(queueItemId)
  }, [])

  useEffect(() => {
    const supabase = createBrowserClient()

    // Fetch initial queue state
    const fetchQueue = async () => {
      const { data, error } = await supabase
        .from("ai_operations_queue")
        .select("*")
        .eq("canvas_id", canvasId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true })

      if (error) {
        console.error("[v0] Error fetching AI queue:", error)
        return
      }

      setQueue(data || [])
      const processing = data?.find((item) => item.status === "processing")
      setCurrentOperation(processing || null)
      setIsAIWorking(!!processing || (data && data.length > 0))
    }

    fetchQueue()

    // Subscribe to queue changes
    const channel = supabase
      .channel(`ai-queue:${canvasId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ai_operations_queue",
          filter: `canvas_id=eq.${canvasId}`,
        },
        (payload) => {
          console.log("[v0] AI queue change:", payload)

          if (payload.eventType === "INSERT") {
            setQueue((prev) => [...prev, payload.new as AIQueueItem])
            setIsAIWorking(true)
          } else if (payload.eventType === "UPDATE") {
            setQueue((prev) => prev.map((item) => (item.id === payload.new.id ? (payload.new as AIQueueItem) : item)))

            const updated = payload.new as AIQueueItem
            if (updated.status === "processing") {
              setCurrentOperation(updated)
              setIsAIWorking(true)
            } else if (updated.status === "completed" || updated.status === "failed") {
              setQueue((prev) => prev.filter((item) => item.id !== updated.id))
              setCurrentOperation(null)
              // Check if there are more pending operations
              setQueue((prev) => {
                setIsAIWorking(prev.length > 0)
                return prev
              })
            }

            if (
              updated.status === "completed" &&
              Array.isArray(updated.operations) &&
              updated.operations.length > 0 &&
              !processedQueueItemsRef.current.has(updated.id)
            ) {
              processedQueueItemsRef.current.add(updated.id)
              onOperationsRef.current?.(updated.operations, updated)
            }
          } else if (payload.eventType === "DELETE") {
            setQueue((prev) => prev.filter((item) => item.id !== payload.old.id))
            if (currentOperationRef.current?.id === payload.old.id) {
              setCurrentOperation(null)
            }
            setQueue((prev) => {
              setIsAIWorking(prev.length > 0)
              return prev
            })
          }
        },
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [canvasId, userId])

  const addToQueue = async (prompt: string, userName: string) => {
    const supabase = createBrowserClient()

    const { data, error } = await supabase
      .from("ai_operations_queue")
      .insert({
        canvas_id: canvasId,
        user_id: userId,
        user_name: userName,
        status: "pending",
        prompt,
      })
      .select()
      .single()

    if (error) {
      console.error("[v0] Error adding to AI queue:", error)
      throw error
    }

    return data as AIQueueItem
  }

  const updateQueueItem = async (id: string, updates: Partial<AIQueueItem>) => {
    const supabase = createBrowserClient()

    const { error } = await supabase.from("ai_operations_queue").update(updates).eq("id", id)

    if (error) {
      console.error("[v0] Error updating AI queue item:", error)
      throw error
    }
  }

  return {
    queue,
    isAIWorking,
    currentOperation,
    addToQueue,
    updateQueueItem,
    markOperationsProcessed,
  }
}
