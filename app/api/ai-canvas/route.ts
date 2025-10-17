import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { generateText, tool } from "ai"
import { z } from "zod"

export const maxDuration = 30

export async function POST(request: Request) {
  console.log("[v0] ===== AI Canvas API Route Called =====")

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

    let queueItemId: string | null = null
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
          const validation = validateMoveShape({ shapeIndex, x, y, deltaX, deltaY }, safeCurrentObjects, selectedIndices)
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
          const validation = validateResizeShape({ shapeIndex, width, height, scale }, safeCurrentObjects, selectedIndices)
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
          shapeIndex: shapeIndexSchema.optional().describe(
            "Index of the shape to delete (0-based, or 'selected' for currently selected shape)",
          ),
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
          shapeIndices: z
            .array(z.number())
            .optional()
            .describe("Indices of shapes to arrange (empty array means all shapes)"),
          spacing: z.number().optional().describe("Spacing between shapes in pixels"),
          columns: z.number().optional().describe("Number of columns (for grid pattern)"),
        }),
        execute: async ({ pattern, shapeIndices, spacing, columns }) => {
          const validation = validateArrangeShapes({ pattern, shapeIndices, spacing, columns }, safeCurrentObjects)
          if (!validation.valid) {
            validationErrors.push(`arrangeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "arrange",
            pattern,
            shapeIndices: shapeIndices || [],
            spacing: spacing || 50,
            columns,
          })

          return { success: true, pattern, shapeIndices, spacing, columns }
        },
      }),
      alignShapes: tool({
        description: "Align two or more shapes along a shared edge or center",
        inputSchema: z.object({
          alignment: z.enum(["left", "right", "top", "bottom", "center", "middle"]).describe(
            "How to align the shapes (left/right/top/bottom/center/middle)",
          ),
          shapeIndices: z.array(z.number()).optional().describe("Specific shape indices to align"),
          useSelection: z.boolean().optional().describe("Align the currently selected shapes"),
        }),
        execute: async ({ alignment, shapeIndices, useSelection }) => {
          const indicesToAlign = Array.from(
            new Set(
              shapeIndices && shapeIndices.length > 0
                ? shapeIndices
                : useSelection
                  ? selectedIndices
                  : [],
            ),
          )

          const validation = validateAlignShapes({ alignment, shapeIndices: indicesToAlign }, safeCurrentObjects)
          if (!validation.valid) {
            validationErrors.push(`alignShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "align",
            alignment,
            shapeIndices: indicesToAlign,
          })

          return { success: true, alignment, shapeIndices: indicesToAlign }
        },
      }),
      distributeShapes: tool({
        description: "Distribute three or more shapes evenly horizontally or vertically",
        inputSchema: z.object({
          direction: z.enum(["horizontal", "vertical"]).describe("Distribution direction"),
          shapeIndices: z.array(z.number()).optional().describe("Specific shape indices to distribute"),
          useSelection: z.boolean().optional().describe("Use currently selected shapes"),
        }),
        execute: async ({ direction, shapeIndices, useSelection }) => {
          const indicesToUse = Array.from(
            new Set(
              shapeIndices && shapeIndices.length > 0
                ? shapeIndices
                : useSelection
                  ? selectedIndices
                  : [],
            ),
          )

          const validation = validateDistributeShapes({ direction, shapeIndices: indicesToUse }, safeCurrentObjects)
          if (!validation.valid) {
            validationErrors.push(`distributeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "distribute",
            direction,
            shapeIndices: indicesToUse,
          })

          return { success: true, direction, shapeIndices: indicesToUse }
        },
      }),
      updateStyle: tool({
        description: "Update fill, stroke, or typography styles on one or more shapes",
        inputSchema: z
          .object({
            targetId: z.string().optional(),
            targetIds: z.array(z.string()).optional(),
            shapeIndex: z.number().optional(),
            shapeIndices: z.array(z.number()).optional(),
            useSelection: z.boolean().optional(),
            fillColor: z.string().optional(),
            strokeColor: z.string().optional(),
            strokeWidth: z.number().optional(),
            textColor: z.string().optional(),
            fontSize: z.number().optional(),
          })
          .refine(
            (value) =>
              value.fillColor ||
              value.strokeColor ||
              value.strokeWidth !== undefined ||
              value.textColor ||
              value.fontSize !== undefined,
            { message: "Provide at least one style property to update." },
          ),
        execute: async (args) => {
          if (args.fillColor && !isValidColorInput(args.fillColor)) {
            const error = `Invalid fill color ${args.fillColor}`
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }
          if (args.strokeColor && !isValidColorInput(args.strokeColor)) {
            const error = `Invalid stroke color ${args.strokeColor}`
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }
          if (args.textColor && !isValidColorInput(args.textColor)) {
            const error = `Invalid text color ${args.textColor}`
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }

          const { ids, indices, error } = resolveTargetIdsForOperation(args)
          if (error) {
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }

          const firstIndex = indices.length > 0 ? indices[0] : -1
          const primary = firstIndex >= 0 ? safeCurrentObjects[firstIndex] : undefined

          const finalFill = args.fillColor
            ? normalizeColorInput(args.fillColor, primary?.fill_color || "#3b82f6")
            : undefined
          const finalStroke = args.strokeColor
            ? normalizeColorInput(args.strokeColor, primary?.stroke_color || "#1f2937")
            : undefined
          const finalTextColor = args.textColor
            ? normalizeColorInput(args.textColor, primary?.fill_color || "#000000")
            : undefined

          operations.push({
            type: "updateStyle",
            targetIds: ids,
            fillColor: finalFill,
            strokeColor: finalStroke,
            strokeWidth: args.strokeWidth,
            textColor: finalTextColor,
            fontSize: args.fontSize,
          })

          return { success: true, targetIds: ids }
        },
      }),
      updateText: tool({
        description: "Update the contents or typography of text objects",
        inputSchema: z.object({
          targetId: z.string().optional(),
          targetIds: z.array(z.string()).optional(),
          shapeIndex: z.number().optional(),
          shapeIndices: z.array(z.number()).optional(),
          useSelection: z.boolean().optional(),
          text: z.string().describe("New text content"),
          fontSize: z.number().optional(),
          textColor: z.string().optional(),
        }),
        execute: async (args) => {
          if (args.textColor && !isValidColorInput(args.textColor)) {
            const error = `Invalid text color ${args.textColor}`
            validationErrors.push(`updateText: ${error}`)
            return { error }
          }

          const { ids, indices, error } = resolveTargetIdsForOperation(args)
          if (error) {
            validationErrors.push(`updateText: ${error}`)
            return { error }
          }

          const firstIndex = indices.length > 0 ? indices[0] : -1
          const primary = firstIndex >= 0 ? safeCurrentObjects[firstIndex] : undefined
          const finalTextColor = args.textColor
            ? normalizeColorInput(args.textColor, primary?.fill_color || "#000000")
            : undefined

          operations.push({
            type: "updateText",
            targetIds: ids,
            text: args.text,
            fontSize: args.fontSize,
            textColor: finalTextColor,
          })

          return { success: true, targetIds: ids, text: args.text }
        },
      }),
      updateLayerState: tool({
        description: "Toggle visibility or locking state on objects",
        inputSchema: z
          .object({
            targetId: z.string().optional(),
            targetIds: z.array(z.string()).optional(),
            shapeIndex: z.number().optional(),
            shapeIndices: z.array(z.number()).optional(),
            useSelection: z.boolean().optional(),
            visibility: z.boolean().optional(),
            locked: z.boolean().optional(),
          })
          .refine((value) => value.visibility !== undefined || value.locked !== undefined, {
            message: "Provide visibility or locked state to update.",
          }),
        execute: async (args) => {
          const { ids, error } = resolveTargetIdsForOperation(args)
          if (error) {
            validationErrors.push(`updateLayerState: ${error}`)
            return { error }
          }

          operations.push({
            type: "updateLayerState",
            targetIds: ids,
            visibility: args.visibility,
            locked: args.locked,
          })

          return { success: true, targetIds: ids }
        },
      }),
      reorderLayers: tool({
        description: "Change layer order (bring forward/backward, front/back)",
        inputSchema: z.object({
          action: z.enum(["bringToFront", "sendToBack", "bringForward", "sendBackward"]).describe(
            "How to reorder the target shapes",
          ),
          targetId: z.string().optional(),
          targetIds: z.array(z.string()).optional(),
          shapeIndex: z.number().optional(),
          shapeIndices: z.array(z.number()).optional(),
          useSelection: z.boolean().optional(),
        }),
        execute: async (args) => {
          const { ids, error } = resolveTargetIdsForOperation(args)
          if (error) {
            validationErrors.push(`reorderLayers: ${error}`)
            return { error }
          }

          operations.push({
            type: "reorder",
            action: args.action,
            targetIds: ids,
          })

          return { success: true, action: args.action, targetIds: ids }
        },
      }),
      duplicateShapes: tool({
        description: "Duplicate shapes with an optional offset",
        inputSchema: z.object({
          targetId: z.string().optional(),
          targetIds: z.array(z.string()).optional(),
          shapeIndex: z.number().optional(),
          shapeIndices: z.array(z.number()).optional(),
          useSelection: z.boolean().optional(),
          offsetX: z.number().optional().describe("Horizontal offset for duplicates"),
          offsetY: z.number().optional().describe("Vertical offset for duplicates"),
        }),
        execute: async (args) => {
          const { ids, error } = resolveTargetIdsForOperation(args)
          if (error) {
            validationErrors.push(`duplicateShapes: ${error}`)
            return { error }
          }

          operations.push({
            type: "duplicate",
            targetIds: ids,
            offsetX: args.offsetX,
            offsetY: args.offsetY,
          })

          return { success: true, targetIds: ids }
        },
      }),
      selectObjects: tool({
        description: "Update the current selection using filters or explicit targets",
        inputSchema: z.object({
          mode: z
            .enum(["set", "add", "remove", "clear", "all"])
            .optional()
            .describe("How to apply the selection change"),
          targetId: z.string().optional(),
          targetIds: z.array(z.string()).optional(),
          shapeIndex: z.number().optional(),
          shapeIndices: z.array(z.number()).optional(),
          useSelection: z.boolean().optional(),
          shapeType: z.enum(["rectangle", "circle", "triangle", "line", "text"]).optional(),
          fillColor: z.string().optional(),
        }),
        execute: async (args) => {
          if (args.fillColor && !isValidColorInput(args.fillColor)) {
            const error = `Invalid color ${args.fillColor}`
            validationErrors.push(`selectObjects: ${error}`)
            return { error }
          }

          const mode = args.mode || "set"
          if (mode === "clear" || mode === "all") {
            operations.push({ type: "select", mode })
            return { success: true, mode }
          }

          let resolvedIds: string[] = []
          if (args.targetId || (Array.isArray(args.targetIds) && args.targetIds.length > 0) || args.shapeIndex !== undefined || (Array.isArray(args.shapeIndices) && args.shapeIndices.length > 0) || args.useSelection) {
            const { ids, error } = resolveTargetIdsForOperation(args)
            if (error) {
              validationErrors.push(`selectObjects: ${error}`)
              return { error }
            }
            resolvedIds = ids
          }

          if (args.shapeType) {
            safeCurrentObjects.forEach((obj: any, idx: number) => {
              if (obj.type === args.shapeType) {
                resolvedIds.push(indexToId[idx])
              }
            })
          }

          if (args.fillColor) {
            const targetColor = normalizeColorInput(args.fillColor, "#000000")
            safeCurrentObjects.forEach((obj: any, idx: number) => {
              const objectColor = normalizeColorInput(
                typeof obj.fill_color === "string" ? obj.fill_color : undefined,
                "#000000",
              )
              if (objectColor === targetColor) {
                resolvedIds.push(indexToId[idx])
              }
            })
          }

          const uniqueIds = Array.from(new Set(resolvedIds))
          if (uniqueIds.length === 0) {
            const error = "No matching shapes found for selection."
            validationErrors.push(`selectObjects: ${error}`)
            return { error }
          }

          operations.push({
            type: "select",
            mode,
            targetIds: uniqueIds,
            shapeType: args.shapeType,
            fillColor: args.fillColor,
          })

          return { success: true, mode, targetIds: uniqueIds }
        },
      }),
      updateViewport: tool({
        description: "Pan or zoom the viewport",
        inputSchema: z.object({
          x: z.number().optional(),
          y: z.number().optional(),
          zoom: z.number().optional(),
          deltaX: z.number().optional(),
          deltaY: z.number().optional(),
          deltaZoom: z.number().optional(),
        }),
        execute: async ({ x, y, zoom, deltaX, deltaY, deltaZoom }) => {
          const validation = validateViewportUpdate({ x, y, zoom, deltaX, deltaY, deltaZoom })
          if (!validation.valid) {
            validationErrors.push(`updateViewport: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "viewport",
            x,
            y,
            zoom,
            deltaX,
            deltaY,
            deltaZoom,
          })

          return { success: true }
        },
      }),
      updateGridSettings: tool({
        description: "Toggle grid visibility, snapping, or size",
        inputSchema: z.object({
          enabled: z.boolean().optional(),
          snap: z.boolean().optional(),
          size: z.number().optional(),
        }),
        execute: async ({ enabled, snap, size }) => {
          const validation = validateGridSettings({ enabled, snap, size })
          if (!validation.valid) {
            validationErrors.push(`updateGridSettings: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "gridSettings",
            enabled,
            snap,
            size,
          })

          return { success: true, enabled, snap, size }
        },
      }),
      createComment: tool({
        description: "Add a comment marker to the canvas",
        inputSchema: z.object({
          x: z.number().describe("X coordinate for the comment"),
          y: z.number().describe("Y coordinate for the comment"),
          content: z.string().min(1).describe("Comment text"),
        }),
        execute: async ({ x, y, content }) => {
          const validation = validateComment({ x, y, content })
          if (!validation.valid) {
            validationErrors.push(`createComment: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "comment",
            x,
            y,
            content,
          })

          return { success: true, x, y }
        },
      }),
      createSnapshot: tool({
        description: "Create a named snapshot in version history",
        inputSchema: z.object({
          name: z.string().optional().describe("Optional label for the snapshot"),
        }),
        execute: async ({ name }) => {
          operations.push({
            type: "snapshot",
            name,
          })

          return { success: true, name }
        },
      }),
      exportCanvas: tool({
        description: "Export the canvas as PNG or SVG",
        inputSchema: z.object({
          format: z.enum(["png", "svg"]).describe("Export format"),
          selectionOnly: z.boolean().optional().describe("Export only the current selection"),
        }),
        execute: async ({ format, selectionOnly }) => {
          const validation = validateExportRequest({ format, selectionOnly })
          if (!validation.valid) {
            validationErrors.push(`exportCanvas: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "export",
            format,
            selectionOnly: selectionOnly ?? false,
          })

          return { success: true, format, selectionOnly: selectionOnly ?? false }
        },
      }),
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

    const systemPrompt = `You are a canvas assistant that helps users create and manipulate shapes on a collaborative canvas.

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

AVAILABLE FUNCTIONS:
1. getCanvasState - Query canvas information (use for questions like "how many shapes?")
2. createShape - Create new shapes (rectangle, circle, triangle, line)
3. moveShape - Move existing shapes by index
4. resizeShape - Resize existing shapes
5. rotateShape - Rotate existing shapes
6. deleteShape - Delete specific shapes or clear all
7. arrangeShapes - Arrange multiple shapes in patterns (grid, row, column, circle)
8. alignShapes - Align shapes along shared edges or centers
9. distributeShapes - Evenly space shapes horizontally or vertically
10. createText - Create a text layer on the canvas
11. updateStyle - Change fill, stroke, or typography on shapes
12. updateText - Edit text content and typography for text objects
13. updateLayerState - Toggle visibility or locking on shapes
14. reorderLayers - Bring shapes forward/backward in the layer stack
15. duplicateShapes - Duplicate shapes with optional offsets
16. selectObjects - Update the current selection using filters or explicit IDs
17. updateViewport - Pan or zoom the canvas viewport
18. updateGridSettings - Toggle grid visibility, snapping, or size
19. createComment - Drop a comment marker with text
20. createLoginForm - Build a multi-element login form layout with labels and button
21. createNavigationBar - Create a navigation bar with menu items
22. createCardLayout - Create a card with media area, text, and button
23. createSnapshot - Save a named snapshot to version history
24. exportCanvas - Export the canvas as PNG or SVG

SHAPE IDENTIFICATION RULES:
- **SELECTED SHAPES**: When user says "the selected shape", "it", "this", "the selection", use the selected indices: ${JSON.stringify(selectedIndices)}
- Use index numbers: 0 = first shape, 1 = second, -1 = last shape
- When user says "the blue rectangle", find the shape by matching type AND color
- When user says "the circle", find the first shape of that type
- When user says "the last shape" or "the latest", use index -1
- If multiple shapes match, operate on the first match or ask for clarification

TEXT LAYER RULES:
- Use createText to add text layers
- Provide text content, position (x, y), font size, and color
- Font size defaults to 16 pixels if not specified
- Text color defaults to black (#000000) if not specified

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

DEFAULT VALUES:
- Shape size: 100x100 pixels
- Spacing: 50 pixels
- Grid columns: 3
- Font size: 16 pixels
- **REQUIRED default position: (${visibleArea.centerX}, ${visibleArea.centerY}) - Always use this for new objects**

BEST PRACTICES:
1. For questions about the canvas, use getCanvasState first
2. For complex operations, call multiple functions in sequence
3. When moving/resizing shapes, verify the shape exists first
4. Be conversational and explain what you're doing
5. If a request is ambiguous, make a reasonable assumption and explain it
6. **ALWAYS check if there's a selected shape before assuming which shape to operate on**
7. **CRITICAL: ALWAYS create new objects at (${visibleArea.centerX}, ${visibleArea.centerY}) - this is within the user's accessible viewport**

Examples:
- "Create a blue square" → createShape(rectangle, x: ${visibleArea.centerX}, y: ${visibleArea.centerY}, 100x100, blue)
- "Move the circle left" → moveShape(find circle index, deltaX: -100)
- "Make it bigger" (with selection) → resizeShape(selected index, scale: 2)
- "How many shapes?" → getCanvasState(query: "count")
- "Delete all red shapes" → Find all red shapes and delete each one
- "Add text 'Hello World'" → createText(text: 'Hello World', x: ${visibleArea.centerX}, y: ${visibleArea.centerY}, fontSize: 24, color: '#000000')`

    const result = await generateText({
      model: "openai/gpt-4o-mini",
      system: systemPrompt,
      prompt: message,
      tools,
      maxSteps: 5,
    })

    console.log("[v0] AI SDK response received")
    console.log("[v0] Operations collected:", operations.length)

    let aiMessage = result.text || "I've processed your request!"

    if (validationErrors.length > 0) {
      aiMessage += `\n\nNote: Some operations couldn't be completed:\n${validationErrors.map((e) => `• ${e}`).join("\n")}`
    }

    if (queueItemId && canvasId) {
      try {
        const supabase = createServiceRoleClient()
        await supabase
          .from("ai_operations_queue")
          .update({
            status: "completed",
            operations: operations,
            completed_at: new Date().toISOString(),
          })
          .eq("id", queueItemId)
      } catch (err) {
        console.warn("[v0] Failed to update queue status:", err)
      }
    }

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

function validateArrangeShapes(args: any, currentObjects: any[]): { valid: boolean; error?: string } {
  if (!args.pattern || !["grid", "row", "column", "circle"].includes(args.pattern)) {
    return { valid: false, error: "Pattern must be one of: grid, row, column, circle." }
  }

  if (args.shapeIndices && !Array.isArray(args.shapeIndices)) {
    return { valid: false, error: "shapeIndices must be an array." }
  }

  if (args.shapeIndices && args.shapeIndices.length > 0) {
    for (const index of args.shapeIndices) {
      if (typeof index !== "number" || index < 0 || index >= currentObjects.length) {
        return {
          valid: false,
          error: `Invalid shape index ${index} in shapeIndices. Canvas has ${currentObjects.length} shapes.`,
        }
      }
    }
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
