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

    const operations: any[] = []
    const validationErrors: string[] = []
    const shapeIndexSchema = z.union([z.number(), z.literal("selected")])
    const shapeIndicesSchema = z.union([
      z.literal("selected"),
      z.array(z.union([z.number(), z.literal("selected")])).min(1),
    ])

    const resolveShapeIndexInput = (shapeIndex: number | "selected" | undefined) => {
      if (shapeIndex === "selected") {
        return selectedIndices.length > 0 ? selectedIndices[0] : null
      }
      if (typeof shapeIndex === "number") {
        return shapeIndex
      }
      return null
    }

    const resolveShapeIndicesInput = (
      shapeIndices: Array<number | "selected"> | "selected" | undefined,
    ): number[] => {
      if (shapeIndices === undefined) {
        return [...selectedIndices]
      }

      const indices: number[] = []

      const appendIndices = (values: number[]) => {
        values.forEach((value) => {
          if (!indices.includes(value)) {
            indices.push(value)
          }
        })
      }

      if (shapeIndices === "selected") {
        appendIndices(selectedIndices)
      } else if (Array.isArray(shapeIndices)) {
        shapeIndices.forEach((value) => {
          if (value === "selected") {
            appendIndices(selectedIndices)
          } else if (typeof value === "number") {
            indices.push(value)
          }
        })
      }

      return indices
    }

    const validateShapeIndices = (indices: number[]): { valid: boolean; error?: string } => {
      if (indices.length === 0) {
        return { valid: false, error: "No target shapes specified or selected." }
      }

      for (const idx of indices) {
        if (idx === -1) {
          // Allow -1 to reference the last shape (including newly created ones later in the sequence)
          continue
        }

        if (idx < 0 || idx >= safeCurrentObjects.length) {
          return {
            valid: false,
            error: `Invalid shape index ${idx}. Canvas has ${safeCurrentObjects.length} shapes (indices 0-${Math.max(
              0,
              safeCurrentObjects.length - 1,
            )}).`,
          }
        }
      }

      return { valid: true }
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
            shapeIndex: validation.resolvedIndex!,
            x,
            y,
            deltaX,
            deltaY,
          })

          return { success: true, shapeIndex: validation.resolvedIndex, x, y, deltaX, deltaY }
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
            shapeIndex: validation.resolvedIndex!,
            width,
            height,
            scale,
          })

          return { success: true, shapeIndex: validation.resolvedIndex, width, height, scale }
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
            shapeIndex: validation.resolvedIndex!,
            degrees: degrees ?? 0,
            absolute: absolute ?? false,
          })

          return { success: true, shapeIndex: validation.resolvedIndex, degrees, absolute }
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
            shapeIndex: validation.resolvedIndex,
            all: all ?? false,
          })

          return { success: true, shapeIndex: validation.resolvedIndex, all }
        },
      }),
      updateText: tool({
        description: "Update the contents or styling of a text object",
        inputSchema: z.object({
          shapeIndex: shapeIndexSchema.describe(
            "Index of the text object to edit (use 'selected' for the current selection, -1 for the last object)",
          ),
          text: z.string().optional().describe("Replace the text content with this string"),
          append: z.string().optional().describe("Append this string to the current text"),
          fontSize: z.number().optional().describe("Update the font size in pixels"),
          color: z.string().optional().describe("Text color as a hex code or named color"),
          fontFamily: z.string().optional().describe("Set a specific font family"),
        }),
        execute: async ({ shapeIndex, text, append, fontSize, color, fontFamily }) => {
          const validation = validateUpdateText(
            { shapeIndex, text, append, fontSize, color, fontFamily },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`updateText: ${validation.error}`)
            return { error: validation.error }
          }

          const resolvedIndex = validation.shapeIndex
          const finalColor = color ? normalizeColorInput(color, "#000000") : undefined

          operations.push({
            type: "updateText",
            shapeIndex: resolvedIndex,
            text,
            append,
            fontSize,
            color: finalColor,
            fontFamily,
          })

          return { success: true, shapeIndex: resolvedIndex, text, append, fontSize, color: finalColor, fontFamily }
        },
      }),
      updateStyle: tool({
        description: "Update fill or stroke styling for one or more shapes",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe(
            "Indices of shapes to update (use 'selected' or include -1 for last shape)",
          ),
          fillColor: z.string().optional().describe("New fill color as hex code or name"),
          strokeColor: z.string().optional().describe("New stroke color as hex code or name"),
          strokeWidth: z.number().optional().describe("Stroke width in pixels"),
        }),
        execute: async ({ shapeIndices, fillColor, strokeColor, strokeWidth }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`updateStyle: ${validation.error}`)
            return { error: validation.error }
          }

          if (!fillColor && !strokeColor && strokeWidth === undefined) {
            const error = "Must provide fillColor, strokeColor, or strokeWidth"
            validationErrors.push(`updateStyle: ${error}`)
            return { error }
          }

          const updates: Record<string, unknown> = { shapeIndices: indices }
          if (fillColor) {
            updates.fillColor = normalizeColorInput(fillColor, "#3b82f6")
          }
          if (strokeColor) {
            updates.strokeColor = normalizeColorInput(strokeColor, "#1f2937")
          }
          if (strokeWidth !== undefined) {
            updates.strokeWidth = strokeWidth
          }

          operations.push({ type: "style", ...updates })

          return { success: true, ...updates }
        },
      }),
      setVisibility: tool({
        description: "Show or hide specific shapes",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe("Shapes to update (defaults to current selection)"),
          visible: z.boolean().describe("Whether the shapes should be visible"),
        }),
        execute: async ({ shapeIndices, visible }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`setVisibility: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({ type: "visibility", shapeIndices: indices, visible })
          return { success: true, shapeIndices: indices, visible }
        },
      }),
      setLock: tool({
        description: "Lock or unlock specific shapes to prevent editing",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe("Shapes to update (defaults to current selection)"),
          locked: z.boolean().describe("Whether the shapes should be locked"),
        }),
        execute: async ({ shapeIndices, locked }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`setLock: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({ type: "lock", shapeIndices: indices, locked })
          return { success: true, shapeIndices: indices, locked }
        },
      }),
      duplicateShapes: tool({
        description: "Duplicate selected shapes with an optional offset",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe("Shapes to duplicate (defaults to current selection)"),
          offsetX: z.number().optional().describe("Horizontal offset for duplicated shapes"),
          offsetY: z.number().optional().describe("Vertical offset for duplicated shapes"),
        }),
        execute: async ({ shapeIndices, offsetX, offsetY }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`duplicateShapes: ${validation.error}`)
            return { error: validation.error }
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
      reorderShapes: tool({
        description: "Change the z-order of shapes (bring to front/back or move one layer)",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe("Shapes to reorder (defaults to current selection)"),
          action: z
            .enum(["bringToFront", "sendToBack", "bringForward", "sendBackward"])
            .describe("Layer action to perform"),
        }),
        execute: async ({ shapeIndices, action }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`reorderShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({ type: "layer", shapeIndices: indices, action })
          return { success: true, shapeIndices: indices, action }
        },
      }),
      copyShapes: tool({
        description: "Copy shapes to the clipboard so they can be pasted later",
        inputSchema: z.object({
          shapeIndices: shapeIndicesSchema.optional().describe("Shapes to copy (defaults to current selection)"),
        }),
        execute: async ({ shapeIndices }) => {
          const indices = resolveShapeIndicesInput(shapeIndices)
          const validation = validateShapeIndices(indices)
          if (!validation.valid) {
            validationErrors.push(`copyShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({ type: "copy", shapeIndices: indices })
          return { success: true, shapeIndices: indices }
        },
      }),
      pasteShapes: tool({
        description: "Paste shapes previously copied to the clipboard",
        inputSchema: z.object({
          offsetX: z.number().optional().describe("Horizontal offset for pasted shapes"),
          offsetY: z.number().optional().describe("Vertical offset for pasted shapes"),
        }),
        execute: async ({ offsetX, offsetY }) => {
          operations.push({
            type: "paste",
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          })

          return { success: true, offsetX: offsetX ?? 20, offsetY: offsetY ?? 20 }
        },
      }),
      arrangeShapes: tool({
        description: "Arrange multiple shapes in a pattern (grid, row, column, circle)",
        inputSchema: z.object({
          pattern: z.enum(["grid", "row", "column", "circle"]).describe("The arrangement pattern"),
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to arrange (empty array means selected shapes)"),
          spacing: z.number().optional().describe("Spacing between shapes in pixels"),
          columns: z.number().optional().describe("Number of columns (for grid pattern)"),
        }),
        execute: async ({ pattern, shapeIndices, spacing, columns }) => {
          const validation = validateArrangeShapes(
            { pattern, shapeIndices, spacing, columns },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`arrangeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "arrange",
            pattern,
            shapeIndices: validation.resolvedIndices!,
            spacing: spacing || 50,
            columns,
          })

          return {
            success: true,
            pattern,
            shapeIndices: validation.resolvedIndices,
            spacing: spacing || 50,
            columns,
          }
        },
      }),
      duplicateShape: tool({
        description: "Duplicate one or more shapes with an optional offset",
        inputSchema: z.object({
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to duplicate (defaults to currently selected shapes)"),
          offsetX: z.number().optional().describe("Horizontal offset for duplicates (default: 20)"),
          offsetY: z.number().optional().describe("Vertical offset for duplicates (default: 20)"),
        }),
        execute: async ({ shapeIndices, offsetX, offsetY }) => {
          const validation = validateDuplicateShape(
            { shapeIndices, offsetX, offsetY },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`duplicateShape: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "duplicate",
            shapeIndices: validation.resolvedIndices!,
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          })

          return {
            success: true,
            shapeIndices: validation.resolvedIndices,
            offsetX: offsetX ?? 20,
            offsetY: offsetY ?? 20,
          }
        },
      }),
      updateStyle: tool({
        description: "Update fill, stroke, or font styling for one or more shapes",
        inputSchema: z.object({
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to style (defaults to currently selected shapes)"),
          fillColor: z.string().optional().describe("Fill color as hex or common color name"),
          strokeColor: z.string().optional().describe("Stroke color as hex or common color name"),
          strokeWidth: z.number().optional().describe("Stroke width in pixels"),
          fontSize: z.number().optional().describe("Font size in pixels (text objects only)"),
        }),
        execute: async ({ shapeIndices, fillColor, strokeColor, strokeWidth, fontSize }) => {
          const validation = validateUpdateStyle(
            { shapeIndices, fillColor, strokeColor, strokeWidth, fontSize },
            safeCurrentObjects,
            selectedIndices,
          )
          if (!validation.valid) {
            validationErrors.push(`updateStyle: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "style",
            shapeIndices: validation.resolvedIndices!,
            fillColor: fillColor ? normalizeColorInput(fillColor, "#3b82f6") : undefined,
            strokeColor: strokeColor ? normalizeColorInput(strokeColor, "#1f2937") : undefined,
            strokeWidth,
            fontSize,
          })

          return {
            success: true,
            shapeIndices: validation.resolvedIndices,
            fillColor: fillColor ? normalizeColorInput(fillColor, "#3b82f6") : undefined,
            strokeColor: strokeColor ? normalizeColorInput(strokeColor, "#1f2937") : undefined,
            strokeWidth,
            fontSize,
          }
        },
      }),
      alignShapes: tool({
        description: "Align multiple shapes along a specified axis",
        inputSchema: z.object({
          alignment: z
            .enum(["left", "right", "top", "bottom", "center", "middle"])
            .describe("Alignment direction"),
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to align (defaults to currently selected shapes)"),
        }),
        execute: async ({ alignment, shapeIndices }) => {
          const validation = validateAlignShapes({ alignment, shapeIndices }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`alignShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "align",
            alignment,
            shapeIndices: validation.resolvedIndices!,
          })

          return { success: true, alignment, shapeIndices: validation.resolvedIndices }
        },
      }),
      distributeShapes: tool({
        description: "Distribute shapes evenly horizontally or vertically",
        inputSchema: z.object({
          direction: z
            .enum(["horizontal", "vertical"])
            .describe("Distribution direction"),
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to distribute (defaults to currently selected shapes)"),
        }),
        execute: async ({ direction, shapeIndices }) => {
          const validation = validateDistributeShapes({ direction, shapeIndices }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`distributeShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "distribute",
            direction,
            shapeIndices: validation.resolvedIndices!,
          })

          return { success: true, direction, shapeIndices: validation.resolvedIndices }
        },
      }),
      reorderShapes: tool({
        description: "Change the stacking order of shapes",
        inputSchema: z.object({
          action: z
            .enum(["bringToFront", "sendToBack", "bringForward", "sendBackward"])
            .describe("Reorder action"),
          shapeIndices: z
            .array(shapeIndexSchema)
            .optional()
            .describe("Indices of shapes to reorder (defaults to currently selected shapes)"),
        }),
        execute: async ({ action, shapeIndices }) => {
          const validation = validateReorderShapes({ action, shapeIndices }, safeCurrentObjects, selectedIndices)
          if (!validation.valid) {
            validationErrors.push(`reorderShapes: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "reorder",
            action,
            shapeIndices: validation.resolvedIndices!,
          })

          return { success: true, action, shapeIndices: validation.resolvedIndices }
        },
      }),
      toggleGrid: tool({
        description: "Update grid visibility, snapping, or size",
        inputSchema: z.object({
          enabled: z.boolean().optional().describe("Whether the grid should be shown"),
          snap: z.boolean().optional().describe("Whether objects should snap to the grid"),
          size: z.number().optional().describe("Grid size in pixels (10, 20, 30, 50, or 100)"),
        }),
        execute: async ({ enabled, snap, size }) => {
          const validation = validateToggleGrid({ enabled, snap, size })
          if (!validation.valid) {
            validationErrors.push(`toggleGrid: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "grid",
            enabled,
            snap,
            size,
          })

          return { success: true, enabled, snap, size }
        },
      }),
      setViewport: tool({
        description: "Pan or zoom the viewport to a specific location",
        inputSchema: z.object({
          x: z.number().optional().describe("Viewport X position"),
          y: z.number().optional().describe("Viewport Y position"),
          zoom: z.number().optional().describe("Zoom level (1.0 = 100%)"),
        }),
        execute: async ({ x, y, zoom }) => {
          const validation = validateSetViewport({ x, y, zoom })
          if (!validation.valid) {
            validationErrors.push(`setViewport: ${validation.error}`)
            return { error: validation.error }
          }

          operations.push({
            type: "viewport",
            x,
            y,
            zoom,
          })

          return { success: true, x, y, zoom }
        },
      }),
      createComment: tool({
        description: "Create a comment at a specified canvas location",
        inputSchema: z.object({
          x: z.number().describe("X coordinate for the comment"),
          y: z.number().describe("Y coordinate for the comment"),
          content: z.string().min(1).describe("Comment text"),
        }),
        execute: async ({ x, y, content }) => {
          const validation = validateCreateComment({ x, y, content })
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

          return { success: true, x, y, content }
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
      toggleGrid: tool({
        description: "Enable or disable the canvas grid overlay",
        inputSchema: z.object({
          enabled: z.boolean().describe("Whether the grid should be enabled"),
          snap: z.boolean().optional().describe("Optional snap-to-grid state to apply simultaneously"),
        }),
        execute: async ({ enabled, snap }) => {
          operations.push({ type: "toggleGrid", enabled, snap })
          return { success: true, enabled, snap }
        },
      }),
      toggleSnap: tool({
        description: "Enable or disable snap-to-grid alignment",
        inputSchema: z.object({
          snap: z.boolean().describe("Whether snap-to-grid should be enabled"),
        }),
        execute: async ({ snap }) => {
          operations.push({ type: "toggleSnap", snap })
          return { success: true, snap }
        },
      }),
      setGridSize: tool({
        description: "Set the grid size for snapping and display",
        inputSchema: z.object({
          size: z.enum(["10", "20", "30", "50", "100"]).or(z.number()).describe("Grid size in pixels"),
        }),
        execute: async ({ size }) => {
          const parsed = typeof size === "number" ? size : Number(size)
          operations.push({ type: "setGridSize", size: parsed })
          return { success: true, size: parsed }
        },
      }),
      updateViewport: tool({
        description: "Pan or zoom the canvas viewport",
        inputSchema: z.object({
          x: z.number().optional().describe("Absolute X offset of the viewport"),
          y: z.number().optional().describe("Absolute Y offset of the viewport"),
          zoom: z.number().optional().describe("Absolute zoom level (1 = 100%)"),
          deltaX: z.number().optional().describe("Pan the viewport horizontally by this amount"),
          deltaY: z.number().optional().describe("Pan the viewport vertically by this amount"),
          zoomFactor: z.number().optional().describe("Multiply current zoom by this factor"),
        }),
        execute: async ({ x, y, zoom, deltaX, deltaY, zoomFactor }) => {
          operations.push({ type: "viewport", x, y, zoom, deltaX, deltaY, zoomFactor })
          return { success: true, x, y, zoom, deltaX, deltaY, zoomFactor }
        },
      }),
      createComment: tool({
        description: "Create a canvas comment at a specific location",
        inputSchema: z.object({
          x: z.number().describe("X coordinate for the comment"),
          y: z.number().describe("Y coordinate for the comment"),
          content: z.string().describe("Comment text"),
        }),
        execute: async ({ x, y, content }) => {
          operations.push({ type: "comment", x, y, content })
          return { success: true, x, y, content }
        },
      }),
      selectAll: tool({
        description: "Select all objects on the canvas",
        inputSchema: z.object({}).optional(),
        execute: async () => {
          operations.push({ type: "selectAll" })
          return { success: true }
        },
      }),
      selectAllOfType: tool({
        description: "Select all objects that match the currently selected types",
        inputSchema: z.object({}).optional(),
        execute: async () => {
          operations.push({ type: "selectAllOfType" })
          return { success: true }
        },
      }),
      undo: tool({
        description: "Undo the last canvas change",
        inputSchema: z.object({}).optional(),
        execute: async () => {
          operations.push({ type: "undo" })
          return { success: true }
        },
      }),
      redo: tool({
        description: "Redo the most recently undone change",
        inputSchema: z.object({}).optional(),
        execute: async () => {
          operations.push({ type: "redo" })
          return { success: true }
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
8. duplicateShape - Duplicate selected shapes with offsets
9. updateStyle - Change fill, stroke, or font styling on shapes
10. alignShapes - Align two or more shapes along an axis
11. distributeShapes - Evenly distribute three or more shapes
12. reorderShapes - Change stacking order (front/back/forward/backward)
13. toggleGrid - Toggle grid visibility, snapping, or size
14. setViewport - Pan or zoom the canvas viewport
15. createText - Create a text layer on the canvas
16. createLoginForm - Build a multi-element login form layout with labels and button
17. createNavigationBar - Create a navigation bar with menu items
18. createCardLayout - Create a card with media area, text, and button
19. createComment - Add a comment marker at a position

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
8. Use updateStyle for color, stroke, or typography changes instead of recreating shapes
9. Use reorderShapes to satisfy "bring to front/back" requests
10. Use toggleGrid and setViewport when users mention grid, snapping, pan, or zoom
11. Use createComment when users ask to leave feedback markers on the canvas

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

function resolveSingleShapeIndex(
  input: number | "selected",
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; index?: number } {
  if (currentObjects.length === 0) {
    return { valid: false, error: "There are no shapes on the canvas." }
  }

  if (input === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    return { valid: true, index: selectedIndices[0] }
  }

  if (typeof input !== "number") {
    return { valid: false, error: "shapeIndex must be a number or 'selected'." }
  }

  const resolved = input === -1 ? currentObjects.length - 1 : input

  if (resolved < 0 || resolved >= currentObjects.length) {
    return {
      valid: false,
      error: `Invalid shape index ${input}. Canvas has ${currentObjects.length} shapes (indices 0-${Math.max(
        0,
        currentObjects.length - 1,
      )}).`,
    }
  }

  return { valid: true, index: resolved }
}

function resolveMultipleShapeIndices(
  input: (number | "selected")[] | undefined,
  currentObjects: any[],
  selectedIndices: number[],
  options: { min?: number; allowEmpty?: boolean } = {},
): { valid: boolean; error?: string; indices?: number[] } {
  const min = options.min ?? 1

  let rawValues: (number | "selected")[]
  if (input && input.length > 0) {
    rawValues = input
  } else {
    if (selectedIndices.length === 0) {
      if (options.allowEmpty) {
        return { valid: true, indices: [] }
      }
      return { valid: false, error: "No shapes are currently selected." }
    }
    rawValues = selectedIndices
  }

  const resolved: number[] = []
  for (const value of rawValues) {
    if (value === "selected") {
      if (selectedIndices.length === 0) {
        return { valid: false, error: "No shapes are currently selected." }
      }
      resolved.push(...selectedIndices)
      continue
    }

    if (typeof value !== "number") {
      return { valid: false, error: "shapeIndices must contain numbers or 'selected'." }
    }

    const normalized = value === -1 ? currentObjects.length - 1 : value
    if (normalized < 0 || normalized >= currentObjects.length) {
      return {
        valid: false,
        error: `Invalid shape index ${value}. Canvas has ${currentObjects.length} shapes (indices 0-${Math.max(
          0,
          currentObjects.length - 1,
        )}).`,
      }
    }

    resolved.push(normalized)
  }

  const uniqueIndices = Array.from(new Set(resolved))

  if (!options.allowEmpty && uniqueIndices.length < min) {
    return {
      valid: false,
      error: min === 1 ? "At least one shape is required." : `At least ${min} shapes are required for this action.`,
    }
  }

  return { valid: true, indices: uniqueIndices }
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

function validateMoveShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndex?: number } {
  const resolved = resolveSingleShapeIndex(args.shapeIndex, currentObjects, selectedIndices)
  if (!resolved.valid) {
    return resolved
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

  return { valid: true, resolvedIndex: resolved.index }
}

function validateResizeShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndex?: number } {
  const resolved = resolveSingleShapeIndex(args.shapeIndex, currentObjects, selectedIndices)
  if (!resolved.valid) {
    return resolved
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

  return { valid: true, resolvedIndex: resolved.index }
}

function validateRotateShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndex?: number } {
  const resolved = resolveSingleShapeIndex(args.shapeIndex, currentObjects, selectedIndices)
  if (!resolved.valid) {
    return resolved
  }

  if (typeof args.degrees !== "number") {
    return { valid: false, error: "Rotation degrees must be a number." }
  }

  return { valid: true, resolvedIndex: resolved.index }
}

function validateDeleteShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndex?: number } {
  if (args.all === true) {
    return { valid: true }
  }

  const resolved = resolveSingleShapeIndex(args.shapeIndex, currentObjects, selectedIndices)
  if (!resolved.valid) {
    return resolved
  }

  return { valid: true, resolvedIndex: resolved.index }
}

function validateArrangeShapes(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (!args.pattern || !["grid", "row", "column", "circle"].includes(args.pattern)) {
    return { valid: false, error: "Pattern must be one of: grid, row, column, circle." }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 1 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  if (args.spacing !== undefined && (typeof args.spacing !== "number" || args.spacing < 0)) {
    return { valid: false, error: "Spacing must be a non-negative number." }
  }

  if (args.columns !== undefined && (typeof args.columns !== "number" || args.columns < 1)) {
    return { valid: false, error: "Columns must be a positive number." }
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
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

  if (args.color !== undefined && typeof args.color !== "string") {
    return { valid: false, error: "Color must be provided as a string." }
  }

  return { valid: true }
}

function validateUpdateStyle(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (
    args.fillColor === undefined &&
    args.strokeColor === undefined &&
    args.strokeWidth === undefined &&
    args.fontSize === undefined
  ) {
    return { valid: false, error: "Provide at least one style property to update." }
  }

  if (args.strokeWidth !== undefined && (typeof args.strokeWidth !== "number" || args.strokeWidth < 0 || args.strokeWidth > 50)) {
    return { valid: false, error: "Stroke width must be a non-negative number not exceeding 50." }
  }

  if (args.fontSize !== undefined && (typeof args.fontSize !== "number" || args.fontSize <= 0 || args.fontSize > 400)) {
    return { valid: false, error: "Font size must be a positive number not exceeding 400." }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 1 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
}

function validateDuplicateShape(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (args.offsetX !== undefined && typeof args.offsetX !== "number") {
    return { valid: false, error: "offsetX must be a number if provided." }
  }

  if (args.offsetY !== undefined && typeof args.offsetY !== "number") {
    return { valid: false, error: "offsetY must be a number if provided." }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 1 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
}

function validateAlignShapes(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (!args.alignment || !["left", "right", "top", "bottom", "center", "middle"].includes(args.alignment)) {
    return { valid: false, error: "Alignment must be one of: left, right, top, bottom, center, middle." }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 2 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
}

function validateDistributeShapes(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (!args.direction || !["horizontal", "vertical"].includes(args.direction)) {
    return { valid: false, error: "Direction must be 'horizontal' or 'vertical'." }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 3 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
}

function validateReorderShapes(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; resolvedIndices?: number[] } {
  if (!args.action || !["bringToFront", "sendToBack", "bringForward", "sendBackward"].includes(args.action)) {
    return {
      valid: false,
      error: "Action must be one of: bringToFront, sendToBack, bringForward, sendBackward.",
    }
  }

  const indicesResult = resolveMultipleShapeIndices(args.shapeIndices, currentObjects, selectedIndices, { min: 1 })
  if (!indicesResult.valid) {
    return indicesResult
  }

  return { valid: true, resolvedIndices: indicesResult.indices }
}

function validateToggleGrid(args: any): { valid: boolean; error?: string } {
  if (args.enabled === undefined && args.snap === undefined && args.size === undefined) {
    return { valid: false, error: "Provide enabled, snap, or size to update grid settings." }
  }

  if (args.size !== undefined && ![10, 20, 30, 50, 100].includes(args.size)) {
    return { valid: false, error: "Grid size must be one of: 10, 20, 30, 50, 100." }
  }

  if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
    return { valid: false, error: "enabled must be a boolean." }
  }

  if (args.snap !== undefined && typeof args.snap !== "boolean") {
    return { valid: false, error: "snap must be a boolean." }
  }

  return { valid: true }
}

function validateSetViewport(args: any): { valid: boolean; error?: string } {
  if (args.x === undefined && args.y === undefined && args.zoom === undefined) {
    return { valid: false, error: "Provide x, y, or zoom to update the viewport." }
  }

  if (args.x !== undefined && typeof args.x !== "number") {
    return { valid: false, error: "Viewport x must be a number." }
  }

  if (args.y !== undefined && typeof args.y !== "number") {
    return { valid: false, error: "Viewport y must be a number." }
  }

  if (args.zoom !== undefined && (typeof args.zoom !== "number" || args.zoom < 0.1 || args.zoom > 5)) {
    return { valid: false, error: "Zoom must be a number between 0.1 and 5." }
  }

  return { valid: true }
}

function validateCreateComment(args: any): { valid: boolean; error?: string } {
  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return { valid: false, error: "Comment position must be numbers." }
  }

  if (args.x < 0 || args.x > 2000 || args.y < 0 || args.y > 2000) {
    return { valid: false, error: "Comment position must be within canvas bounds (0-2000)." }
  }

  if (typeof args.content !== "string" || args.content.trim().length === 0) {
    return { valid: false, error: "Comment content must be a non-empty string." }
  }

  return { valid: true }
}

function validateUpdateText(
  args: any,
  currentObjects: any[],
  selectedIndices: number[],
): { valid: boolean; error?: string; shapeIndex?: number } {
  let resolvedIndex: number | null = null

  if (args.shapeIndex === "selected") {
    if (selectedIndices.length === 0) {
      return { valid: false, error: "No shape is currently selected." }
    }
    resolvedIndex = selectedIndices[0]
  } else if (typeof args.shapeIndex === "number") {
    resolvedIndex = args.shapeIndex
  }

  if (resolvedIndex === null || resolvedIndex === undefined) {
    return { valid: false, error: "shapeIndex must be provided." }
  }

  if (resolvedIndex !== -1) {
    if (resolvedIndex < 0 || resolvedIndex >= currentObjects.length) {
      return {
        valid: false,
        error: `Invalid shape index ${resolvedIndex}. Canvas has ${currentObjects.length} shapes.`,
      }
    }

    const target = currentObjects[resolvedIndex]
    if (target && target.type !== "text") {
      return { valid: false, error: "Target shape is not a text object." }
    }
  } else if (currentObjects.length === 0) {
    // No shapes exist yet, so referencing the last shape would fail
    return { valid: false, error: "There are no shapes on the canvas to edit." }
  }

  if (!args.text && !args.append && args.fontSize === undefined && !args.color && !args.fontFamily) {
    return { valid: false, error: "Must provide text, append, fontSize, color, or fontFamily to update." }
  }

  if (args.fontSize !== undefined && (typeof args.fontSize !== "number" || args.fontSize <= 0)) {
    return { valid: false, error: "Font size must be a positive number." }
  }

  return { valid: true, shapeIndex: resolvedIndex }
}
