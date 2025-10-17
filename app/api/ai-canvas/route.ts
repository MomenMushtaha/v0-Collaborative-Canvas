import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { generateText, tool } from "ai"
import { z } from "zod"

export const maxDuration = 30

const MAX_HISTORY_MESSAGES = 12

const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
})

const conversationHistorySchema = z.array(conversationMessageSchema)

type ConversationMessage = z.infer<typeof conversationMessageSchema>

async function updateQueueStatus(queueItemId: string | null, updates: Record<string, unknown>) {
  if (!queueItemId) return

  try {
    const supabase = createServiceRoleClient()
    await supabase.from("ai_operations_queue").update(updates).eq("id", queueItemId)
  } catch (err) {
    console.warn("[v0] Failed to update queue status:", err)
  }
}

export async function POST(request: Request) {
  console.log("[v0] ===== AI Canvas API Route Called =====")

  let queueItemId: string | null = null

  try {
    const body = await request.json()
    const {
      message,
      currentObjects,
      selectedObjectIds,
      selectedObjects: selectedObjectsPayload,
      canvasId,
      userId,
      userName,
      viewport,
      conversationHistory: conversationHistoryPayload,
    } = body

    console.log("[v0] Message:", message)
    const safeCurrentObjects = Array.isArray(currentObjects) ? currentObjects : []
    const safeSelectedIds = Array.isArray(selectedObjectIds) ? selectedObjectIds : []
    const safeSelectedObjects = Array.isArray(selectedObjectsPayload) ? selectedObjectsPayload : []

    console.log("[v0] Current objects count:", safeCurrentObjects.length)
    console.log("[v0] Selected objects count:", safeSelectedIds.length)
    console.log("[v0] Canvas ID:", canvasId)
    console.log("[v0] User:", userName)

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    if (currentObjects && !Array.isArray(currentObjects)) {
      return NextResponse.json(
        { error: "Invalid currentObjects format", details: "currentObjects must be an array" },
        { status: 400 },
      )
    }

    const conversationHistoryResult = conversationHistorySchema.safeParse(
      Array.isArray(conversationHistoryPayload) ? conversationHistoryPayload : [],
    )

    if (!conversationHistoryResult.success && conversationHistoryPayload) {
      console.warn("[v0] Invalid conversation history provided, ignoring.")
    }

    const safeConversationHistory = conversationHistoryResult.success
      ? conversationHistoryResult.data.slice(-MAX_HISTORY_MESSAGES)
      : []

    const historyEnsuredLatestUser = (() => {
      if (safeConversationHistory.length === 0) {
        return [{ role: "user", content: message } satisfies ConversationMessage]
      }

      const lastEntry = safeConversationHistory[safeConversationHistory.length - 1]
      if (lastEntry.role !== "user" || lastEntry.content !== message) {
        return [...safeConversationHistory, { role: "user", content: message } satisfies ConversationMessage]
      }

      return safeConversationHistory
    })()

    const conversationMessages = historyEnsuredLatestUser.map((entry) => ({
      role: entry.role,
      content: entry.content,
    }))

    if (canvasId && userId && userName) {
      try {
        const supabase = createServiceRoleClient()
        const { data: queueItem, error: queueError } = await supabase
          .from("ai_operations_queue")
          .insert({
            canvas_id: canvasId,
            user_id: userId,
            user_name: userName,
            status: "processing",
            prompt: message,
            started_at: new Date().toISOString(),
          })
          .select()
          .single()

        if (queueError) {
          console.warn("[v0] Queue management unavailable (table may not exist):", queueError.message)
        } else {
          queueItemId = queueItem.id
          console.log("[v0] Added to queue with ID:", queueItemId)
        }
      } catch (queueErr) {
        console.warn("[v0] Queue management error (continuing without queue):", queueErr)
      }
    }

    console.log("[v0] Calling AI SDK with function calling...")

    const canvasContext = safeCurrentObjects.map((obj: any, idx: number) => {
      const objectId = (() => {
        if (typeof obj.id === "string" && obj.id.length > 0) {
          return obj.id
        }
        if (obj.id !== undefined && obj.id !== null) {
          return String(obj.id)
        }
        return `object-${idx}`
      })()

      const isSelectedFromIds = safeSelectedIds.includes(objectId)
      const isSelectedFromPayload = safeSelectedObjects.some((selected: any) => {
        if (!selected) return false
        if (typeof selected === "string") {
          return selected === objectId
        }
        if (typeof selected?.id === "string" && selected.id.length > 0) {
          return selected.id === objectId
        }
        if (selected?.id !== undefined && selected?.id !== null) {
          return String(selected.id) === objectId
        }
        return false
      })

      const toRoundedNumber = (value: any, fallback = 0) =>
        typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback

      return {
        index: idx,
        id: objectId,
        type: obj.type,
        color: obj.fill_color,
        strokeColor: obj.stroke_color,
        strokeWidth: typeof obj.stroke_width === "number" ? obj.stroke_width : undefined,
        x: toRoundedNumber(obj.x),
        y: toRoundedNumber(obj.y),
        width: toRoundedNumber(obj.width),
        height: toRoundedNumber(obj.height),
        rotation: typeof obj.rotation === "number" ? obj.rotation : 0,
        text: obj.text_content || obj.content || "",
        locked: Boolean(obj.locked),
        visible: obj.visible !== false,
        isSelected: isSelectedFromIds || isSelectedFromPayload,
      }
    })

    const selectedContext = canvasContext.filter((obj: any) => obj.isSelected)
    const selectedIndices = selectedContext.map((obj: any) => obj.index)
    const selectedIds = selectedContext
      .map((obj: any) => (typeof obj.id === "string" ? obj.id : undefined))
      .filter((id: string | undefined): id is string => Boolean(id))

    const canvasStats = {
      totalShapes: safeCurrentObjects.length,
      shapeTypes: safeCurrentObjects.reduce(
        (acc: any, obj: any) => {
          acc[obj.type] = (acc[obj.type] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
      colorGroups: safeCurrentObjects.reduce(
        (acc: any, obj: any) => {
          const color = obj.fill_color
          acc[color] = (acc[color] || 0) + 1
          return acc
        },
        {} as Record<string, number>,
      ),
    }

    const indexToId = safeCurrentObjects.map((obj: any, idx: number) => {
      if (typeof obj?.id === "string" && obj.id.length > 0) {
        return obj.id
      }
      if (obj?.id !== undefined && obj?.id !== null) {
        return String(obj.id)
      }
      return `object-${idx}`
    })

    const canvasWidth = typeof window !== "undefined" ? window.innerWidth : 1920
    const canvasHeight = typeof window !== "undefined" ? window.innerHeight : 1080

    const visibleArea = viewport
      ? {
          left: Math.max(0, Math.round(-viewport.x / viewport.zoom)),
          top: Math.max(0, Math.round(-viewport.y / viewport.zoom)),
          right: Math.min(2000, Math.round((-viewport.x + canvasWidth) / viewport.zoom)),
          bottom: Math.min(2000, Math.round((-viewport.y + canvasHeight) / viewport.zoom)),
          centerX: Math.round((-viewport.x + canvasWidth / 2) / viewport.zoom),
          centerY: Math.round((-viewport.y + 150) / viewport.zoom),
        }
      : {
          left: 0,
          top: 0,
          right: 1920,
          bottom: 1080,
          centerX: 960,
          centerY: 150,
        }

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
    const clampCenter = (value: number | undefined, size: number, fallback: number) =>
      clamp(value ?? fallback, size / 2, 2000 - size / 2)
    const clampTopLeft = (value: number | undefined, size: number, fallback: number) =>
      clamp(value ?? fallback, 0, 2000 - size)

    const NAMED_COLORS: Record<string, string> = {
      black: "#000000",
      white: "#ffffff",
      red: "#ef4444",
      blue: "#3b82f6",
      green: "#22c55e",
      yellow: "#eab308",
      purple: "#a855f7",
      pink: "#ec4899",
      orange: "#f97316",
      cyan: "#06b6d4",
      teal: "#14b8a6",
      indigo: "#6366f1",
      gray: "#6b7280",
      slate: "#1f2937",
      navy: "#1d4ed8",
    }

    const normalizeColorInput = (input: string | undefined, fallback: string) => {
      if (!input) {
        return fallback
      }

      if (/^#[0-9A-Fa-f]{6}$/.test(input)) {
        return input
      }

      const normalized = input.toLowerCase().trim()
      return NAMED_COLORS[normalized] || fallback
    }

    const isValidColorInput = (input: string | undefined) => {
      if (!input) return false
      if (/^#[0-9A-Fa-f]{6}$/.test(input)) {
        return true
      }
      const normalized = input.toLowerCase().trim()
      return Boolean(NAMED_COLORS[normalized])
    }

    const operations: any[] = []
    const validationErrors: string[] = []
    const shapeIndexSchema = z.union([z.number(), z.literal("selected")])
    const multiShapeTargetSchema = z
      .union([z.array(z.number()), z.literal("selected"), z.literal("all")])
      .optional()

    const resolveTargetIndices = (
      target: number[] | "selected" | "all" | undefined,
      {
        requireMultiple = false,
        defaultToAllIfNone = false,
        min = 1,
      }: { requireMultiple?: boolean; defaultToAllIfNone?: boolean; min?: number } = {},
    ): { indices?: number[]; error?: string } => {
      if (safeCurrentObjects.length === 0) {
        return { error: "There are no shapes on the canvas." }
      }

      let indices: number[] = []

      if (target === "all") {
        indices = safeCurrentObjects.map((_, idx) => idx)
      } else if (Array.isArray(target) && target.length > 0) {
        indices = target.map((value) => (value === -1 ? safeCurrentObjects.length - 1 : value))
      } else if (target === "selected" || (!target && !defaultToAllIfNone)) {
        indices = [...selectedIndices]
      }

      if (indices.length === 0 && defaultToAllIfNone) {
        indices = safeCurrentObjects.map((_, idx) => idx)
      }

      const unique = Array.from(new Set(indices))
      const invalidIndex = unique.find((idx) => idx < 0 || idx >= safeCurrentObjects.length)

      if (invalidIndex !== undefined) {
        return {
          error: `Invalid shape index ${invalidIndex}. Canvas has ${safeCurrentObjects.length} shapes (indices 0-${Math.max(
            safeCurrentObjects.length - 1,
            0,
          )}).`,
        }
      }

      if (unique.length < min) {
        return {
          error:
            unique.length === 0
              ? "No shapes specified or selected for this operation."
              : `This operation requires at least ${min} shape${min > 1 ? "s" : ""}.`,
        }
      }

      if (requireMultiple && unique.length < 2) {
        return { error: "Select at least two shapes or specify their indices for this operation." }
      }

      return { indices: unique }
    }

    const resolveTargetIdsForOperation = (
      args: any,
    ): { ids: string[]; indices: number[]; error?: string } => {
      const ids = new Set<string>()
      const indices = new Set<number>()

      const addId = (rawId: any) => {
        if (typeof rawId !== "string") {
          return false
        }
        const normalizedId = rawId
        const idx = indexToId.indexOf(normalizedId)
        if (idx === -1) {
          return false
        }
        ids.add(normalizedId)
        indices.add(idx)
        return true
      }

      const addIndex = (index: any) => {
        if (typeof index !== "number" || index < 0 || index >= indexToId.length) {
          return { ok: false, error: `Invalid shape index ${index}. Canvas has ${indexToId.length} shapes.` }
        }
        ids.add(indexToId[index])
        indices.add(index)
        return { ok: true }
      }

      if (typeof args?.targetId === "string") {
        if (!addId(args.targetId)) {
          return { ids: [], error: `Unknown target id ${args.targetId}` }
        }
      }

      if (Array.isArray(args?.targetIds)) {
        for (const id of args.targetIds) {
          if (!addId(id)) {
            return { ids: [], error: `Unknown target id ${id}` }
          }
        }
      }

      if (args?.shapeIndex === "selected") {
        if (selectedIds.length === 0) {
          return { ids: [], indices: [], error: "No shapes are currently selected." }
        }
        selectedIds.forEach((id) => addId(id))
      } else if (args?.shapeIndex !== undefined) {
        const result = addIndex(args.shapeIndex)
        if (!result.ok) {
          return { ids: [], indices: [], error: result.error }
        }
      }

      if (Array.isArray(args?.shapeIndices)) {
        for (const index of args.shapeIndices) {
          const result = addIndex(index)
          if (!result.ok) {
            return { ids: [], indices: [], error: result.error }
          }
        }
      }

      if (args?.useSelection) {
        if (selectedIds.length === 0) {
          return { ids: [], indices: [], error: "No shapes are currently selected." }
        }
        selectedIds.forEach((id) => addId(id))
      }

      const resolved = Array.from(ids)
      if (resolved.length === 0) {
        return { ids: [], indices: [], error: "Specify at least one target shape." }
      }

      return { ids: resolved, indices: Array.from(indices) }
    }

    const tools = {
      // ===== QUERY & INFORMATION =====
      getCanvasState: tool({
        description:
          "Query information about the current canvas state. Use this to answer questions about shapes, count objects, or get information before making changes.",
        inputSchema: z.object({
          query: z.string().describe("What information to retrieve (e.g., 'count', 'list all', 'find blue shapes')"),
        }),
        execute: async ({ query }) => {
          return {
            query,
            canvasContext,
            canvasStats,
            selectedObjects: selectedContext,
            availableOperations: Object.keys(tools),
          }
        },
      }),

      // ===== SELECTION OPERATIONS =====
      selectObjects: tool({
        description: "Select one or more objects by their indices or IDs. Replaces current selection.",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Array of object indices to select"),
          ids: z.array(z.string()).optional().describe("Array of object IDs to select"),
          addToSelection: z.boolean().optional().describe("If true, add to current selection instead of replacing"),
        }),
        execute: async ({ indices, ids, addToSelection }) => {
          const targetIds = ids || indices?.map((i) => canvasContext[i]?.id).filter(Boolean) || []
          operations.push({
            type: "select",
            objectIds: targetIds,
            addToSelection: addToSelection || false,
          })
          return { success: true, selectedCount: targetIds.length }
        },
      }),

      selectAll: tool({
        description: "Select all objects on the canvas",
        inputSchema: z.object({}),
        execute: async () => {
          operations.push({
            type: "selectAll",
          })
          return { success: true, selectedCount: canvasContext.length }
        },
      }),

      selectAllOfType: tool({
        description: "Select all objects of the same type as currently selected objects",
        inputSchema: z.object({
          type: z
            .enum(["rectangle", "circle", "triangle", "line", "text"])
            .optional()
            .describe("Specific type to select, or use currently selected types"),
        }),
        execute: async ({ type }) => {
          const targetType = type || (selectedContext.length > 0 ? selectedContext[0].type : undefined)
          if (!targetType) {
            return { error: "No type specified and no objects selected" }
          }
          operations.push({
            type: "selectAllOfType",
            objectType: targetType,
          })
          const matchingCount = canvasContext.filter((obj) => obj.type === targetType).length
          return { success: true, selectedCount: matchingCount, objectType: targetType }
        },
      }),

      clearSelection: tool({
        description: "Deselect all objects",
        inputSchema: z.object({}),
        execute: async () => {
          operations.push({
            type: "clearSelection",
          })
          return { success: true }
        },
      }),

      // ===== CLIPBOARD OPERATIONS =====
      copyObjects: tool({
        description: "Copy selected objects to clipboard",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices to copy, or use current selection"),
        }),
        execute: async ({ indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to copy" }
          }
          operations.push({
            type: "copy",
            objectIndices: targetIndices,
          })
          return { success: true, copiedCount: targetIndices.length }
        },
      }),

      pasteObjects: tool({
        description: "Paste objects from clipboard at specified position or with offset",
        inputSchema: z.object({
          x: z.number().optional().describe("X position to paste at"),
          y: z.number().optional().describe("Y position to paste at"),
          offsetX: z.number().optional().describe("X offset from original position (default: 20)"),
          offsetY: z.number().optional().describe("Y offset from original position (default: 20)"),
        }),
        execute: async ({ x, y, offsetX, offsetY }) => {
          operations.push({
            type: "paste",
            x,
            y,
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          })
          return { success: true }
        },
      }),

      duplicateObjects: tool({
        description: "Duplicate selected objects with an offset",
        inputSchema: z.object({
          offsetX: z.number().optional().describe("X offset for duplicates (default: 20)"),
          offsetY: z.number().optional().describe("Y offset for duplicates (default: 20)"),
        }),
        execute: async ({ offsetX, offsetY }) => {
          if (selectedIndices.length === 0) {
            return { error: "No objects selected to duplicate" }
          }
          operations.push({
            type: "duplicate",
            objectIndices: selectedIndices,
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          })
          return { success: true, duplicatedCount: selectedIndices.length }
        },
      }),

      // ===== STYLING OPERATIONS =====
      setFillColor: tool({
        description: "Change the fill color of selected objects",
        inputSchema: z.object({
          color: z.string().describe("Hex color code (e.g., #ff0000) or color name (red, blue, green)"),
          indices: z.array(z.number()).optional().describe("Specific indices to style, or use current selection"),
        }),
        execute: async ({ color, indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to style" }
          }
          const finalColor = normalizeColorInput(color, "#3b82f6")
          operations.push({
            type: "setStyle",
            objectIndices: targetIndices,
            fillColor: finalColor,
          })
          return { success: true, styledCount: targetIndices.length, color: finalColor }
        },
      }),

      setStrokeColor: tool({
        description: "Change the stroke/border color of selected objects",
        inputSchema: z.object({
          color: z.string().describe("Hex color code (e.g., #ff0000) or color name"),
          indices: z.array(z.number()).optional().describe("Specific indices to style, or use current selection"),
        }),
        execute: async ({ color, indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to style" }
          }
          const finalColor = normalizeColorInput(color, "#1e40af")
          operations.push({
            type: "setStyle",
            objectIndices: targetIndices,
            strokeColor: finalColor,
          })
          return { success: true, styledCount: targetIndices.length, color: finalColor }
        },
      }),

      setStrokeWidth: tool({
        description: "Change the stroke/border width of selected objects",
        inputSchema: z.object({
          width: z.number().min(0).max(20).describe("Stroke width in pixels (0-20)"),
          indices: z.array(z.number()).optional().describe("Specific indices to style, or use current selection"),
        }),
        execute: async ({ width, indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to style" }
          }
          operations.push({
            type: "setStyle",
            objectIndices: targetIndices,
            strokeWidth: width,
          })
          return { success: true, styledCount: targetIndices.length, strokeWidth: width }
        },
      }),

      // ===== ALIGNMENT & DISTRIBUTION =====
      alignObjects: tool({
        description: "Align multiple selected objects (requires 2+ objects)",
        inputSchema: z.object({
          alignment: z.enum(["left", "center", "right", "top", "middle", "bottom"]).describe("Alignment type"),
          indices: z.array(z.number()).optional().describe("Specific indices to align, or use current selection"),
        }),
        execute: async ({ alignment, indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length < 2) {
            return { error: "Need at least 2 objects to align" }
          }
          operations.push({
            type: "align",
            objectIndices: targetIndices,
            alignment,
          })
          return { success: true, alignedCount: targetIndices.length, alignment }
        },
      }),

      distributeObjects: tool({
        description: "Distribute multiple selected objects evenly (requires 3+ objects)",
        inputSchema: z.object({
          direction: z.enum(["horizontal", "vertical"]).describe("Distribution direction"),
          indices: z.array(z.number()).optional().describe("Specific indices to distribute, or use current selection"),
        }),
        execute: async ({ direction, indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length < 3) {
            return { error: "Need at least 3 objects to distribute" }
          }
          operations.push({
            type: "distribute",
            objectIndices: targetIndices,
            direction,
          })
          return { success: true, distributedCount: targetIndices.length, direction }
        },
      }),

      // ===== Z-ORDER / LAYERING =====
      bringToFront: tool({
        description: "Bring selected objects to the front (highest z-index)",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
        }),
        execute: async ({ indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to reorder" }
          }
          operations.push({
            type: "bringToFront",
            objectIndices: targetIndices,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      sendToBack: tool({
        description: "Send selected objects to the back (lowest z-index)",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
        }),
        execute: async ({ indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to reorder" }
          }
          operations.push({
            type: "sendToBack",
            objectIndices: targetIndices,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      bringForward: tool({
        description: "Bring selected objects one layer forward",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
        }),
        execute: async ({ indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to reorder" }
          }
          operations.push({
            type: "bringForward",
            objectIndices: targetIndices,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      sendBackward: tool({
        description: "Send selected objects one layer backward",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
        }),
        execute: async ({ indices }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to reorder" }
          }
          operations.push({
            type: "sendBackward",
            objectIndices: targetIndices,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      // ===== VISIBILITY & LOCKING =====
      toggleVisibility: tool({
        description: "Toggle visibility of objects (show/hide)",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
          visible: z.boolean().optional().describe("Set specific visibility state, or toggle current state"),
        }),
        execute: async ({ indices, visible }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to modify" }
          }
          operations.push({
            type: "toggleVisibility",
            objectIndices: targetIndices,
            visible,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      toggleLock: tool({
        description: "Toggle lock state of objects (prevent/allow editing)",
        inputSchema: z.object({
          indices: z.array(z.number()).optional().describe("Specific indices, or use current selection"),
          locked: z.boolean().optional().describe("Set specific lock state, or toggle current state"),
        }),
        execute: async ({ indices, locked }) => {
          const targetIndices = indices || selectedIndices
          if (targetIndices.length === 0) {
            return { error: "No objects to modify" }
          }
          operations.push({
            type: "toggleLock",
            objectIndices: targetIndices,
            locked,
          })
          return { success: true, count: targetIndices.length }
        },
      }),

      // ===== GRID CONTROLS =====
      toggleGrid: tool({
        description: "Toggle grid visibility on/off",
        inputSchema: z.object({
          enabled: z.boolean().optional().describe("Set specific state, or toggle current state"),
        }),
        execute: async ({ enabled }) => {
          operations.push({
            type: "toggleGrid",
            enabled,
          })
          return { success: true, enabled }
        },
      }),

      toggleSnapToGrid: tool({
        description: "Toggle snap-to-grid on/off",
        inputSchema: z.object({
          enabled: z.boolean().optional().describe("Set specific state, or toggle current state"),
        }),
        execute: async ({ enabled }) => {
          operations.push({
            type: "toggleSnapToGrid",
            enabled,
          })
          return { success: true, enabled }
        },
      }),

      setGridSize: tool({
        description: "Change the grid size",
        inputSchema: z.object({
          size: z.enum(["10", "20", "30", "50", "100"]).describe("Grid size in pixels"),
        }),
        execute: async ({ size }) => {
          operations.push({
            type: "setGridSize",
            size: Number.parseInt(size),
          })
          return { success: true, gridSize: Number.parseInt(size) }
        },
      }),

      // ===== VIEWPORT CONTROLS =====
      setZoom: tool({
        description: "Set canvas zoom level",
        inputSchema: z.object({
          zoom: z.number().min(1).max(3).describe("Zoom level (1.0 = 100%, 2.0 = 200%, 3.0 = 300%)"),
        }),
        execute: async ({ zoom }) => {
          operations.push({
            type: "setZoom",
            zoom,
          })
          return { success: true, zoom }
        },
      }),

      panViewport: tool({
        description: "Pan the viewport to a specific position or by offset",
        inputSchema: z.object({
          x: z.number().optional().describe("Absolute X position"),
          y: z.number().optional().describe("Absolute Y position"),
          deltaX: z.number().optional().describe("Relative X movement"),
          deltaY: z.number().optional().describe("Relative Y movement"),
        }),
        execute: async ({ x, y, deltaX, deltaY }) => {
          operations.push({
            type: "panViewport",
            x,
            y,
            deltaX,
            deltaY,
          })
          return { success: true }
        },
      }),

      // ===== EXISTING CREATION & MANIPULATION TOOLS =====
      createText: tool({
        description: "Create a text layer on the canvas with customizable content, position, size, and color",
        inputSchema: z.object({
          text: z.string().describe("The text content to display"),
          x: z.number().describe("X coordinate position on the canvas"),
          y: z.number().describe("Y coordinate position on the canvas"),
          fontSize: z.number().optional().describe("Font size in pixels (default: 16)"),
          color: z.string().optional().describe("Text color as hex code (e.g., #000000 for black)"),
        }),
        execute: async ({ text, x, y, fontSize, color }) => {
          const validation = validateCreateText({ text, x, y, fontSize, color })
          if (!validation.valid) {
            validationErrors.push(`createText: ${validation.error}`)
            return { error: validation.error }
          }

          const finalColor = normalizeColorInput(color, "#000000")

          operations.push({
            type: "createText",
            text,
            x,
            y,
            fontSize: fontSize || 16,
            color: finalColor,
          })

          return { success: true, text, x, y, fontSize: fontSize || 16, color: finalColor }
        },
      }),

      createShape: tool({
        description: "Create a new shape on the canvas",
        inputSchema: z.object({
          shape: z.enum(["rectangle", "circle", "triangle", "line"]).describe("The type of shape to create"),
          x: z.number().describe("X coordinate position on the canvas"),
          y: z.number().describe("Y coordinate position on the canvas"),
          width: z.number().describe("Width of the shape in pixels"),
          height: z.number().describe("Height of the shape in pixels"),
          color: z.string().describe("Hex color code (e.g., #ff0000 for red, #3b82f6 for blue)"),
        }),
        execute: async ({ shape, x, y, width, height, color }) => {
          const validation = validateCreateShape({ shape, x, y, width, height, color })
          if (!validation.valid) {
            validationErrors.push(`createShape: ${validation.error}`)
            return { error: validation.error }
          }

          const finalColor = normalizeColorInput(color, "#3b82f6")

          operations.push({
            type: "create",
            object: {
              id: crypto.randomUUID(),
              type: shape,
              x,
              y,
              width,
              height,
              rotation: 0,
              fill_color: finalColor,
              stroke_color: finalColor,
              stroke_width: 2,
            },
          })

          return { success: true, shape, x, y, width, height, color: finalColor }
        },
      }),

      moveShape: tool({
        description: "Move an existing shape to a new position",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to move (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          x: z.number().optional().describe("New X coordinate (absolute position)"),
          y: z.number().optional().describe("New Y coordinate (absolute position)"),
          deltaX: z.number().optional().describe("Relative X movement (alternative to absolute x)"),
          deltaY: z.number().optional().describe("Relative Y movement (alternative to absolute y)"),
        }),
        execute: async ({ shapeIndex, x, y, deltaX, deltaY }) => {
          const validation = validateMoveShape(
            { shapeIndex, x, y, deltaX, deltaY },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`moveShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "move",
            shapeIndex: shapeIndex === -1 ? safeCurrentObjects.length - 1 : shapeIndex,
            x,
            y,
            deltaX,
            deltaY,
          })

          return { success: true, shapeIndex, x, y, deltaX, deltaY }
        },
      }),

      resizeShape: tool({
        description: "Resize an existing shape",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to resize (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          width: z.number().optional().describe("New width in pixels (absolute size)"),
          height: z.number().optional().describe("New height in pixels (absolute size)"),
          scale: z.number().optional().describe("Scale factor (e.g., 2 for twice as big, 0.5 for half size)"),
        }),
        execute: async ({ shapeIndex, width, height, scale }) => {
          const validation = validateResizeShape(
            { shapeIndex, width, height, scale },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`resizeShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "resize",
            shapeIndex: shapeIndex === -1 ? safeCurrentObjects.length - 1 : shapeIndex,
            width,
            height,
            scale,
          })

          return { success: true, shapeIndex, width, height, scale }
        },
      }),

      rotateShape: tool({
        description: "Rotate an existing shape",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the shape to rotate (0-based, use -1 for last shape, or 'selected' for currently selected shape)",
          ),
          degrees: z.number().describe("Rotation amount in degrees"),
          absolute: z
            .boolean()
            .optional()
            .describe("If true, set absolute rotation; if false, rotate relative to current rotation"),
        }),
        execute: async ({ shapeIndex, degrees, absolute }) => {
          const validation = validateRotateShape({ shapeIndex, degrees, absolute }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`rotateShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "rotate",
            shapeIndex: shapeIndex === -1 ? safeCurrentObjects.length - 1 : shapeIndex,
            degrees: degrees ?? 0,
            absolute: absolute ?? false,
          })

          return { success: true, shapeIndex, degrees, absolute }
        },
      }),

      deleteShape: tool({
        description: "Delete one or more shapes from the canvas",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema
            .optional()
            .describe("Index of the shape to delete (0-based, or 'selected' for currently selected shape)"),
          all: z.boolean().optional().describe("If true, delete all shapes from the canvas"),
        }),
        execute: async ({ shapeIndex, all }) => {
          const validation = validateDeleteShape({ shapeIndex, all }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`deleteShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "delete",
            shapeIndex:
              shapeIndex === undefined ? undefined : shapeIndex === -1 ? safeCurrentObjects.length - 1 : shapeIndex,
            all: all ?? false,
          })

          return { success: true, shapeIndex, all }
        },
      }),

      arrangeShapes: tool({
        description: "Arrange multiple shapes in a pattern (grid, row, column, circle)",
        inputSchema: z.object({
          pattern: z.enum(["grid", "row", "column", "circle"]).describe("The arrangement pattern"),
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to arrange (defaults to the current selection; use 'all' for every shape)",
          ),
          spacing: z.number().optional().describe("Spacing between shapes in pixels"),
          columns: z.number().optional().describe("Number of columns (for grid pattern)"),
        }),
        execute: async ({ pattern, shapeTarget, spacing, columns }) => {
          const validation = validateArrangeShapes({ pattern, spacing, columns })
          if (!validation.valid) {
            validationErrors.push(`arrangeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1, defaultToAllIfNone: true })
          if (error || !indices) {
            validationErrors.push(`arrangeShapes: ${error}`)
            return { error }
          }

          operations.push({
            type: "arrange",
            pattern,
            shapeIndices: indices,
            spacing: spacing || 50,
            columns,
            centerX: visibleArea.centerX,
            centerY: visibleArea.centerY,
          })

          return { success: true, pattern, shapeIndices: indices, spacing: spacing || 50, columns }
        },
      }),
      alignShapes: tool({
        description:
          "Align two or more shapes (left, right, top, bottom, center, or middle). Defaults to the current selection.",
        inputSchema: z.object({
          alignment: z
            .enum(["left", "right", "top", "bottom", "center", "middle"])
            .describe("How to align the shapes"),
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to align (defaults to the current selection; use 'all' for every shape)",
          ),
        }),
        execute: async ({ alignment, shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, {
            requireMultiple: true,
            defaultToAllIfNone: true,
          })

          if (error || !indices) {
            validationErrors.push(`alignShapes: ${error}`)
            return { error }
          }

          operations.push({ type: "align", alignment, shapeIndices: indices })

          return { success: true, alignment, shapeIndices: indices }
        },
      }),
      distributeShapes: tool({
        description:
          "Distribute spacing between shapes horizontally or vertically. Defaults to the current selection.",
        inputSchema: z.object({
          direction: z.enum(["horizontal", "vertical"]).describe("Distribute horizontally or vertically"),
          spacing: z.number().optional().describe("Exact spacing between shapes in pixels"),
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to distribute (defaults to the current selection; use 'all' for every shape)",
          ),
        }),
        execute: async ({ direction, spacing, shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, {
            requireMultiple: true,
            defaultToAllIfNone: true,
          })

          if (error || !indices) {
            validationErrors.push(`distributeShapes: ${error}`)
            return { error }
          }

          operations.push({ type: "distribute", direction, spacing, shapeIndices: indices })

          return { success: true, direction, spacing, shapeIndices: indices }
        },
      }),
      updateStyle: tool({
        description:
          "Update fill, stroke, or text styling for one or more shapes. Defaults to the current selection.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to style (defaults to the current selection; use 'all' for every shape)",
          ),
          fillColor: z.string().optional().describe("New fill color (hex code or common color name)"),
          strokeColor: z.string().optional().describe("New stroke color (hex code or common color name)"),
          strokeWidth: z.number().optional().describe("New stroke width in pixels"),
          textColor: z.string().optional().describe("New text color for text objects"),
        }),
        execute: async ({ shapeTarget, fillColor, strokeColor, strokeWidth, textColor }) => {
          if (!fillColor && !strokeColor && strokeWidth === undefined && !textColor) {
            const error = "Provide at least one style property to update."
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }

          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }

          const firstShape = safeCurrentObjects[indices[0]]
          const resolvedFill = fillColor ? normalizeColorInput(fillColor, firstShape?.fill_color || "#3b82f6") : undefined
          const resolvedStroke = strokeColor
            ? normalizeColorInput(strokeColor, firstShape?.stroke_color || "#1f2937")
            : undefined
          const resolvedText = textColor ? normalizeColorInput(textColor, "#111827") : undefined

          operations.push({
            type: "updateStyle",
            shapeIndices: indices,
            fillColor: resolvedFill,
            strokeColor: resolvedStroke,
            strokeWidth,
            textColor: resolvedText,
          })

          return {
            success: true,
            shapeIndices: indices,
            fillColor: resolvedFill,
            strokeColor: resolvedStroke,
            strokeWidth,
            textColor: resolvedText,
          }
        },
      }),
      duplicateShapes: tool({
        description:
          "Duplicate one or more shapes (defaults to the current selection) and offset them for easy visibility.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to duplicate (defaults to the current selection; use 'all' for every shape)",
          ),
          offsetX: z.number().optional().describe("Horizontal offset for duplicates (default 20px)"),
          offsetY: z.number().optional().describe("Vertical offset for duplicates (default 20px)"),
        }),
        execute: async ({ shapeTarget, offsetX, offsetY }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`duplicateShapes: ${error}`)
            return { error }
          }

          operations.push({
            type: "duplicate",
            shapeIndices: indices,
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          })

          return { success: true, shapeIndices: indices, offsetX: offsetX ?? 20, offsetY: offsetY ?? 20 }
        },
      }),
      bringShapesToFront: tool({
        description: "Move shapes to the front of the canvas stacking order.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to bring forward (defaults to the current selection)",
          ),
        }),
        execute: async ({ shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`bringShapesToFront: ${error}`)
            return { error }
          }

          operations.push({ type: "bringToFront", shapeIndices: indices })
          return { success: true, shapeIndices: indices }
        },
      }),
      sendShapesToBack: tool({
        description: "Move shapes to the back of the canvas stacking order.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to send backward (defaults to the current selection)",
          ),
        }),
        execute: async ({ shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`sendShapesToBack: ${error}`)
            return { error }
          }

          operations.push({ type: "sendToBack", shapeIndices: indices })
          return { success: true, shapeIndices: indices }
        },
      }),
      bringShapesForward: tool({
        description: "Move shapes one layer forward in the stacking order.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to move forward (defaults to the current selection)",
          ),
        }),
        execute: async ({ shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`bringShapesForward: ${error}`)
            return { error }
          }

          operations.push({ type: "bringForward", shapeIndices: indices })
          return { success: true, shapeIndices: indices }
        },
      }),
      sendShapesBackward: tool({
        description: "Move shapes one layer backward in the stacking order.",
        inputSchema: z.object({
          shapeTarget: multiShapeTargetSchema.describe(
            "Which shapes to move backward (defaults to the current selection)",
          ),
        }),
        execute: async ({ shapeTarget }) => {
          const { indices, error } = resolveTargetIndices(shapeTarget, { min: 1 })
          if (error || !indices) {
            validationErrors.push(`sendShapesBackward: ${error}`)
            return { error }
          }

          operations.push({ type: "sendBackward", shapeIndices: indices })
          return { success: true, shapeIndices: indices }
        },
      }),

      // ===== COMPLEX LAYOUT TOOLS =====
      createLoginForm: tool({
        description:
          "Create a polished login form with title, username/password fields, and a primary action button arranged vertically.",
        inputSchema: z.object({
          x: z.number().optional().describe("Center X coordinate for the form"),
          y: z.number().optional().describe("Center Y coordinate for the form"),
          title: z.string().optional().describe("Heading text to display above the form"),
          subtitle: z.string().optional().describe("Optional supporting text shown below the title"),
          primaryColor: z.string().optional().describe("Accent color for the button (hex code or common color name)"),
        }),
        execute: async ({ x, y, title, subtitle, primaryColor }) => {
          const formWidth = 360
          const formHeight = 320
          const centerX = clampCenter(x, formWidth, visibleArea.centerX)
          const centerY = clampCenter(y, formHeight, visibleArea.centerY)
          const buttonColor = normalizeColorInput(primaryColor, "#3b82f6")

          operations.push({
            type: "createLoginForm",
            x: centerX,
            y: centerY,
            width: formWidth,
            height: formHeight,
            titleText: title || "Welcome back",
            subtitleText: subtitle || "Please sign in to continue",
            usernameLabel: "Email",
            passwordLabel: "Password",
            buttonText: "Sign In",
            backgroundColor: "#ffffff",
            fieldColor: "#f3f4f6",
            buttonColor,
            buttonTextColor: "#ffffff",
            textColor: "#111827",
            mutedTextColor: "#6b7280",
            helpText: "Forgot password?",
          })

          return { success: true, x: centerX, y: centerY, width: formWidth, height: formHeight }
        },
      }),

      createNavigationBar: tool({
        description:
          "Create a horizontal navigation bar with a brand label and evenly spaced menu items across the top of the canvas.",
        inputSchema: z.object({
          items: z.number().int().min(2).max(8).optional().describe("How many navigation items to include (2-8)"),
          x: z.number().optional().describe("Center X coordinate for the navigation bar"),
          y: z.number().optional().describe("Top Y coordinate for the navigation bar (defaults to top of view)"),
          brand: z.string().optional().describe("Brand or product name to show on the left"),
          accentColor: z.string().optional().describe("Highlight color for the active navigation item"),
        }),
        execute: async ({ items, x, y, brand, accentColor }) => {
          const navItems = clamp(items ?? 4, 2, 8)
          const navWidth = Math.max(420, Math.min(960, navItems * 140))
          const navHeight = 64
          const centerX = clampCenter(x, navWidth, visibleArea.centerX)
          const topY = clampTopLeft(y, navHeight, visibleArea.top)
          const leftX = clamp(centerX - navWidth / 2, 0, 2000 - navWidth)
          const highlightColor = normalizeColorInput(accentColor, "#3b82f6")

          operations.push({
            type: "createNavBar",
            x: leftX,
            y: topY,
            width: navWidth,
            height: navHeight,
            items: navItems,
            brandText: brand || "Product",
            menuItems: Array.from({ length: navItems }, (_, index) => (index === 0 ? "Home" : `Item ${index + 1}`)),
            backgroundColor: "#111827",
            itemColor: "#1f2937",
            activeItemColor: highlightColor,
            textColor: "#f9fafb",
          })

          return { success: true, x: leftX, y: topY, width: navWidth, height: navHeight, items: navItems }
        },
      }),

      createCardLayout: tool({
        description:
          "Create a content card with an image placeholder, title, description text, and call-to-action button.",
        inputSchema: z.object({
          x: z.number().optional().describe("Center X coordinate for the card"),
          y: z.number().optional().describe("Center Y coordinate for the card"),
          title: z.string().optional().describe("Title text inside the card"),
          description: z.string().optional().describe("Supporting description text for the card"),
          buttonText: z.string().optional().describe("Call-to-action label for the card button"),
          accentColor: z.string().optional().describe("Accent color for the media area and button"),
        }),
        execute: async ({ x, y, title, description, buttonText, accentColor }) => {
          const cardWidth = 320
          const cardHeight = 220
          const centerX = clampCenter(x, cardWidth, visibleArea.centerX)
          const centerY = clampCenter(y, cardHeight, visibleArea.centerY)
          const accent = normalizeColorInput(accentColor, "#3b82f6")

          operations.push({
            type: "createCard",
            x: centerX,
            y: centerY,
            width: cardWidth,
            height: cardHeight,
            titleText: title || "Card title",
            descriptionText: description || "Add supporting details here.",
            buttonText: buttonText || "Learn more",
            accentColor: accent,
            backgroundColor: "#ffffff",
            textColor: "#111827",
            mutedTextColor: "#6b7280",
            buttonTextColor: "#ffffff",
          })

          return { success: true, x: centerX, y: centerY, width: cardWidth, height: cardHeight }
        },
      }),
    }

    const systemPrompt = `You are an advanced canvas assistant with FULL USER CAPABILITIES. You can perform ANY action a human user can perform on the collaborative canvas.

CANVAS DIMENSIONS: 2000x2000 pixels
CANVAS CENTER: (1000, 1000)
VIEWPORT: Users can pan and zoom (100% to 300%)

${
  viewport
    ? `
CURRENT VIEWPORT (User's visible area):
- Zoom: ${Math.round(viewport.zoom * 100)}%
- Visible area: (${visibleArea.left}, ${visibleArea.top}) to (${visibleArea.right}, ${visibleArea.bottom})
- Recommended position for new objects: (${visibleArea.centerX}, ${visibleArea.centerY})

⭐ CRITICAL: Always create new objects at (${visibleArea.centerX}, ${visibleArea.centerY}) to ensure they appear in the user's accessible viewport area.
`
    : `
⭐ CRITICAL: Create new objects in the top-right accessible area (default: x=960, y=150) since users have zoom constraints.
`
}

CURRENT CANVAS STATE:
Total shapes: ${canvasStats.totalShapes}
${canvasStats.totalShapes > 0 ? `Shape types: ${JSON.stringify(canvasStats.shapeTypes)}` : ""}
${canvasStats.totalShapes > 0 ? `Colors used: ${JSON.stringify(canvasStats.colorGroups)}` : ""}

${
  selectedContext.length > 0
    ? `
⭐ CURRENTLY SELECTED SHAPES (${selectedContext.length}):
${JSON.stringify(selectedContext, null, 2)}
Selected indices: ${JSON.stringify(selectedIndices)}

IMPORTANT: When the user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
`
    : "No shapes are currently selected.\n"
}

OBJECTS ON CANVAS (${safeCurrentObjects.length} total):
${JSON.stringify(canvasContext, null, 2)}

COMPREHENSIVE TOOL CATEGORIES:

**QUERY & INFORMATION:**
- getCanvasState - Query canvas information

**SELECTION:**
- selectObjects - Select specific objects by index or ID
- selectAll - Select all objects
- selectAllOfType - Select all objects of same type
- clearSelection - Deselect all

**CLIPBOARD:**
- copyObjects - Copy to clipboard
- pasteObjects - Paste from clipboard
- duplicateObjects - Duplicate with offset

**CREATION:**
- createShape - Create rectangles, circles, triangles, lines
- createText - Create text layers
- createLoginForm - Multi-element login form
- createNavigationBar - Navigation bar with menu items
- createCardLayout - Content card with media and button

**MANIPULATION:**
- moveShape - Move objects
- resizeShape - Resize objects
- rotateShape - Rotate objects
- deleteShape - Delete objects
- arrangeShapes - Arrange in patterns (grid, row, column, circle)

**STYLING:**
- setFillColor - Change fill color
- setStrokeColor - Change stroke/border color
- setStrokeWidth - Change stroke width

**ALIGNMENT & DISTRIBUTION:**
- alignObjects - Align left/center/right/top/middle/bottom (2+ objects)
- distributeObjects - Distribute horizontally/vertically (3+ objects)

**Z-ORDER / LAYERING:**
- bringToFront - Move to highest layer
- sendToBack - Move to lowest layer
- bringForward - Move up one layer
- sendBackward - Move down one layer

**VISIBILITY & LOCKING:**
- toggleVisibility - Show/hide objects
- toggleLock - Lock/unlock objects

**GRID CONTROLS:**
- toggleGrid - Show/hide grid
- toggleSnapToGrid - Enable/disable snap
- setGridSize - Change grid size (10/20/30/50/100px)

**VIEWPORT:**
- setZoom - Set zoom level (1.0-3.0)
- panViewport - Pan to position or by offset

SHAPE IDENTIFICATION RULES:
- **SELECTED SHAPES**: When user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
- Use index numbers: 0 = first shape, 1 = second, -1 = last shape
- When user says "the blue rectangle", find the shape by matching type AND color
- When user says "the circle", find the first shape of that type
- When user says "the last shape" or "the latest", use index -1
- If multiple shapes match, operate on the first match or ask for clarification

COLOR REFERENCE (use hex codes):
- red: #ef4444, blue: #3b82f6, green: #22c55e, yellow: #eab308
- purple: #a855f7, pink: #ec4899, orange: #f97316, cyan: #06b6d4
- teal: #14b8a6, indigo: #6366f1, gray: #6b7280
- black: #000000, white: #ffffff

POSITION REFERENCE:
${
  viewport
    ? `
- **REQUIRED position for new objects**: (${visibleArea.centerX}, ${visibleArea.centerY}) - This is in the user's visible area
- Visible top-left: (${visibleArea.left}, ${visibleArea.top})
- Visible top-right: (${visibleArea.right}, ${visibleArea.top})
- Visible bottom-left: (${visibleArea.left}, ${visibleArea.bottom})
- Visible bottom-right: (${visibleArea.right}, ${visibleArea.bottom})
`
    : `
- **REQUIRED position for new objects**: (960, 150) - Top-right accessible area
- Accessible area: (0, 0) to (1920, 1080)
`
}

BEST PRACTICES:
1. **Be conversational and natural** - Explain what you're doing in friendly language
2. **Chain operations intelligently** - For complex requests, use multiple tools in sequence
3. **Verify before acting** - Use getCanvasState to check canvas state before making changes
4. **Handle ambiguity gracefully** - Make reasonable assumptions and explain them
5. **Respect selection context** - Always check if objects are selected before assuming which to operate on
6. **Position awareness** - ALWAYS create new objects at (${visibleArea.centerX}, ${visibleArea.centerY})
7. **Multi-step operations** - Break complex requests into logical steps
8. **Memory and context** - Remember previous conversation context and user preferences

EXAMPLE INTERACTIONS:
- "Create a blue square" → createShape(rectangle, x: ${visibleArea.centerX}, y: ${visibleArea.centerY}, 100x100, blue)
- "Select all circles" → selectAllOfType(type: "circle")
- "Make them red" (with selection) → setFillColor(color: "#ef4444")
- "Align them to the left" (2+ selected) → alignObjects(alignment: "left")
- "Bring it to front" (with selection) → bringToFront()
- "Copy and paste it over there" → copyObjects() then pasteObjects(x: newX, y: newY)
- "Hide the selected shapes" → toggleVisibility(visible: false)
- "Turn on the grid" → toggleGrid(enabled: true)
- "Zoom in" → setZoom(zoom: 2.0)
- "How many shapes?" → getCanvasState(query: "count")

You have COMPLETE parity with human users. You can do EVERYTHING they can do. Be helpful, intelligent, and seamless in your interactions.`

    let result
    try {
      result = await generateText({
        model: "openai/gpt-4o-mini",
        system: systemPrompt,
        messages: conversationMessages,
        tools,
        maxSteps: 5,
        maxRetries: 2,
      })
    } catch (primaryError) {
      console.warn("[v0] Primary AI call failed, attempting fallback:", primaryError)
      const minimalHistory = conversationMessages.slice(-3)

      if (minimalHistory.length === conversationMessages.length) {
        await updateQueueStatus(queueItemId, {
          status: "failed",
          operations: [],
          completed_at: new Date().toISOString(),
        })

        return NextResponse.json({
          message:
            "I ran into a temporary issue while processing that request. Please try again in a moment or rephrase what you need.",
          operations: [],
          queueItemId,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        })
      }

      try {
        result = await generateText({
          model: "openai/gpt-4o-mini",
          system: systemPrompt,
          messages: minimalHistory,
          tools,
          maxSteps: 5,
          maxRetries: 2,
        })
        console.log("[v0] Fallback AI call succeeded with reduced context")
      } catch (fallbackError) {
        console.error("[v0] Fallback AI call failed:", fallbackError)
        await updateQueueStatus(queueItemId, {
          status: "failed",
          operations: [],
          completed_at: new Date().toISOString(),
        })

        return NextResponse.json({
          message:
            "I ran into a temporary issue while processing that request. Please try again in a moment or rephrase what you need.",
          operations: [],
          queueItemId,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
        })
      }
    }

    console.log("[v0] AI SDK response received")
    console.log("[v0] Operations collected:", operations.length)

    let aiMessage = result.text || "I've processed your request!"

    if (validationErrors.length > 0) {
      aiMessage += `\n\nNote: Some operations couldn't be completed:\n${validationErrors.map((e) => `• ${e}`).join("\n")}`
    }

    await updateQueueStatus(queueItemId, {
      status: "completed",
      operations: operations,
      completed_at: new Date().toISOString(),
    })

    console.log("[v0] Returning", operations.length, "operations")
    return NextResponse.json({
      message: aiMessage,
      operations,
      queueItemId,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
    })
  } catch (error) {
    console.error("[v0] ===== API ERROR =====")
    console.error("[v0] Error type:", error?.constructor?.name)
    console.error("[v0] Error message:", error instanceof Error ? error.message : String(error))
    console.error("[v0] Error stack:", error instanceof Error ? error.stack : "No stack trace")

    await updateQueueStatus(queueItemId, {
      status: "failed",
      operations: [],
      completed_at: new Date().toISOString(),
    })

    return NextResponse.json(
      {
        error: "Failed to process request",
        details: error instanceof Error ? error.message : String(error),
        type: error?.constructor?.name || "Unknown",
      },
      { status: 500 },
    )
  }
}

function validateCreateShape(args: any): { valid: boolean; error?: string } {
  if (!args.shape || !["rectangle", "circle", "triangle", "line"].includes(args.shape)) {
    return { valid: false, error: "Invalid shape type. Must be rectangle, circle, triangle, or line." }
  }

  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Position (x, y) must be numbers." }
  }

  if (typeof args.width !== "number" || typeof args.height !== "number") {
    return { valid: false, error: "Dimensions (width, height) must be numbers." }
  }

  if (args.width <= 0 || args.height <= 0) {
    return { valid: false, error: "Dimensions must be positive numbers." }
  }

  if (args.width > 2000 || args.height > 2000) {
    return { valid: false, error: "Dimensions cannot exceed 2000 pixels." }
  }

  if (args.x < 0 || args.x > 2000 || args.y < 0 || args.y > 2000) {
    return { valid: false, error: "Position must be within canvas bounds (0-2000)." }
  }

  return { valid: true }
}

function validateAlignShapes(args: any, currentObjects: any[]): { valid: boolean; error?: string } {
  if (!args.alignment || !["left", "right", "top", "bottom", "center", "middle"].includes(args.alignment)) {
    return { valid: false, error: "Alignment must be left, right, top, bottom, center, or middle." }
  }

  if (!Array.isArray(args.shapeIndices) || args.shapeIndices.length < 2) {
    return { valid: false, error: "Aligning shapes requires at least two shape indices." }
  }

  for (const index of args.shapeIndices) {
    if (typeof index !== "number" || index < 0 || index >= currentObjects.length) {
      return { valid: false, error: `Invalid shape index ${index}.` }
    }
  }

  return { valid: true }
}

function validateDistributeShapes(args: any, currentObjects: any[]): { valid: boolean; error?: string } {
  if (!args.direction || !["horizontal", "vertical"].includes(args.direction)) {
    return { valid: false, error: "Direction must be horizontal or vertical." }
  }

  if (!Array.isArray(args.shapeIndices) || args.shapeIndices.length < 3) {
    return { valid: false, error: "Distributing shapes requires at least three shape indices." }
  }

  for (const index of args.shapeIndices) {
    if (typeof index !== "number" || index < 0 || index >= currentObjects.length) {
      return { valid: false, error: `Invalid shape index ${index}.` }
    }
  }

  return { valid: true }
}

function validateViewportUpdate(args: any): { valid: boolean; error?: string } {
  const numericKeys = ["x", "y", "zoom", "deltaX", "deltaY", "deltaZoom"]
  for (const key of numericKeys) {
    if (args[key] !== undefined && (typeof args[key] !== "number" || !Number.isFinite(args[key]))) {
      return { valid: false, error: `${key} must be a finite number.` }
    }
  }

  if (args.zoom !== undefined && args.zoom <= 0) {
    return { valid: false, error: "Zoom must be greater than 0." }
  }

  return { valid: true }
}

function validateGridSettings(args: any): { valid: boolean; error?: string } {
  if (args.size !== undefined) {
    if (typeof args.size !== "number" || !Number.isFinite(args.size)) {
      return { valid: false, error: "Grid size must be a finite number." }
    }

    if (args.size <= 0 || args.size > 500) {
      return { valid: false, error: "Grid size must be between 1 and 500." }
    }
  }

  if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
    return { valid: false, error: "Grid enabled must be a boolean." }
  }

  if (args.snap !== undefined && typeof args.snap !== "boolean") {
    return { valid: false, error: "Snap must be a boolean." }
  }

  return { valid: true }
}

function validateComment(args: any): { valid: boolean; error?: string } {
  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Comment position must include numeric x and y." }
  }

  if (args.x < 0 || args.x > 2000 || args.y < 0 || args.y > 2000) {
    return { valid: false, error: "Comment position must be within the canvas bounds (0-2000)." }
  }

  if (!args.content || typeof args.content !== "string" || args.content.trim().length === 0) {
    return { valid: false, error: "Comment content cannot be empty." }
  }

  return { valid: true }
}

function validateExportRequest(args: any): { valid: boolean; error?: string } {
  if (!args.format || !["png", "svg"].includes(args.format)) {
    return { valid: false, error: "Export format must be png or svg." }
  }

  if (args.selectionOnly !== undefined && typeof args.selectionOnly !== "boolean") {
    return { valid: false, error: "selectionOnly must be a boolean." }
  }

  return { valid: true }
}

function validateMoveShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes (indices 0-${currentObjects.length - 1}).`,
    }
  }

  if (args.x !== undefined && (typeof args.x !== "number" || args.x < 0 || args.x > 2000)) {
    return { valid: false, error: "X position must be a number between 0 and 2000." }
  }

  if (args.y !== undefined && (typeof args.y !== "number" || args.y < 0 || args.y > 2000)) {
    return { valid: false, error: "Y position must be a number between 0 and 2000." }
  }

  if (args.deltaX !== undefined && typeof args.deltaX !== "number") {
    return { valid: false, error: "deltaX must be a number." }
  }

  if (args.deltaY !== undefined && typeof args.deltaY !== "number") {
    return { valid: false, error: "deltaY must be a number." }
  }

  if (args.x === undefined && args.y === undefined && args.deltaX === undefined && args.deltaY === undefined) {
    return {
      valid: false,
      error: "Must provide either absolute position (x, y) or relative movement (deltaX, deltaY).",
    }
  }

  return { valid: true }
}

function validateResizeShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes (indices 0-${currentObjects.length - 1}).`,
    }
  }

  if (args.width !== undefined && (typeof args.width !== "number" || args.width <= 0 || args.width > 2000)) {
    return { valid: false, error: "Width must be a positive number not exceeding 2000." }
  }

  if (args.height !== undefined && (typeof args.height !== "number" || args.height <= 0 || args.height > 2000)) {
    return { valid: false, error: "Height must be a positive number not exceeding 2000." }
  }

  if (args.scale !== undefined && (typeof args.scale !== "number" || args.scale <= 0 || args.scale > 10)) {
    return { valid: false, error: "Scale must be a positive number between 0 and 10." }
  }

  if (args.width === undefined && args.height === undefined && args.scale === undefined) {
    return { valid: false, error: "Must provide either dimensions (width, height) or scale factor." }
  }

  return { valid: true }
}

function validateRotateShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes.`,
    }
  }

  if (typeof args.degrees !== "number") {
    return { valid: false, error: "Rotation degrees must be a number." }
  }

  return { valid: true }
}

function validateDeleteShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string } {
  if (args.all === true) {
    return { valid: true }
  }

  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    args.shapeIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex !== "number") {
    return { valid: false, error: "shapeIndex must be a number, or set all: true to delete all shapes." }
  }

  const actualIndex = args.shapeIndex === -1 ? currentObjects.length - 1 : args.shapeIndex

  if (actualIndex < 0 || actualIndex >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${args.shapeIndex}. Canvas has ${currentObjects.length} shapes.`,
    }
  }

  return { valid: true }
}

function validateArrangeShapes(args: any): { valid: boolean; error?: string } {
  if (!args.pattern || !["grid", "row", "column", "circle"].includes(args.pattern)) {
    return { valid: false, error: "Pattern must be one of: grid, row, column, circle." }
  }

  if (args.spacing !== undefined && (typeof args.spacing !== "number" || args.spacing < 0)) {
    return { valid: false, error: "Spacing must be a non-negative number." }
  }

  if (args.columns !== undefined && (typeof args.columns !== "number" || args.columns < 1)) {
    return { valid: false, error: "Columns must be a positive number." }
  }

  return { valid: true }
}

function validateCreateText(args: any): { valid: boolean; error?: string } {
  if (!args.text) {
    return { valid: false, error: "Text content is required." }
  }

  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Position (x, y) must be numbers." }
  }

  if (args.fontSize !== undefined && (typeof args.fontSize !== "number" || args.fontSize <= 0)) {
    return { valid: false, error: "Font size must be a positive number." }
  }

  if (args.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(args.color)) {
    return { valid: false, error: "Invalid color format. Must be a hex code." }
  }

  return { valid: true }
}
