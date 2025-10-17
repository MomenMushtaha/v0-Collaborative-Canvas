"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, Sparkles, Loader2 } from "lucide-react"
import type { CanvasObject } from "@/lib/types"

interface AiChatProps {
  currentObjects: CanvasObject[]
  selectedObjectIds: string[]
  onOperations: (operations: any[], queueItemId: string) => void
  userId: string
  userName: string
  canvasId: string
  viewport: { x: number; y: number; zoom: number }
}

interface Message {
  role: "user" | "assistant"
  content: string
}

interface OperationProgress {
  current: number
  total: number
  operation: string
}

export function AiChat({
  currentObjects,
  selectedObjectIds,
  onOperations,
  userId,
  userName,
  canvasId,
  viewport,
}: AiChatProps) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [operationProgress, setOperationProgress] = useState<OperationProgress | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage = input.trim()
    setInput("")
    setMessages((prev) => [...prev, { role: "user", content: userMessage }])
    setIsLoading(true)
    setOperationProgress(null)

    const aiRequestStart = performance.now()

    try {
      console.log("[v0] Sending AI request:", userMessage)
      const sanitizedObjects = currentObjects.map((obj) => ({
        id: obj.id,
        type: obj.type,
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        rotation: obj.rotation,
        fill_color: obj.fill_color,
        stroke_color: obj.stroke_color,
        stroke_width: obj.stroke_width,
        text_content: obj.text_content,
        font_size: obj.font_size,
        font_family: obj.font_family,
        locked: obj.locked ?? false,
        visible: obj.visible ?? true,
      }))

      const selectedObjects = sanitizedObjects.filter((obj) => selectedObjectIds.includes(obj.id))

      const response = await fetch("/api/ai-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          canvasId,
          userId,
          userName,
          viewport,
          currentObjects: sanitizedObjects,
          selectedObjectIds,
          selectedObjects,
        }),
      })

      const aiResponseTime = performance.now() - aiRequestStart
      console.log(`[v0] [PERF] AI response time: ${aiResponseTime.toFixed(0)}ms`)

      console.log("[v0] Response status:", response.status)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error("[v0] API error response:", errorData)
        throw new Error(errorData.details || errorData.error || "Failed to get AI response")
      }

      const data = await response.json()
      console.log("[v0] AI response data:", data)

      if (data.operations && data.operations.length > 0) {
        console.log(`[v0] [PERF] AI generated ${data.operations.length} operations in ${aiResponseTime.toFixed(0)}ms`)
      }

      let assistantMessage = data.message
      if (data.validationErrors && data.validationErrors.length > 0) {
        console.warn("[v0] Validation errors:", data.validationErrors)
        assistantMessage += `\n\nNote: ${data.validationErrors.join(", ")}`
      }

      setMessages((prev) => [...prev, { role: "assistant", content: assistantMessage }])

      if (data.operations && data.operations.length > 0) {
        console.log("[v0] AI operations:", data.operations)
        onOperations(data.operations, data.queueItemId)
      }
    } catch (error) {
      console.error("[v0] AI chat error:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${errorMessage}. Please try again or rephrase your request.`,
        },
      ])
    } finally {
      setIsLoading(false)
      setTimeout(() => setOperationProgress(null), 1000)
    }
  }

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-xl border border-border/50 bg-gradient-to-r from-blue-600 to-cyan-600 px-6 py-3 text-white shadow-xl backdrop-blur-md transition-all duration-200 hover:shadow-2xl hover:scale-105 hover:from-blue-700 hover:to-cyan-700"
      >
        <Sparkles className="h-5 w-5" />
        <span className="font-medium">AI Assistant</span>
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 flex-col rounded-lg border border-border bg-background shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-3.5 text-white rounded-t-lg">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span className="font-semibold text-base">AI Canvas Assistant</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="text-white/80 hover:text-white transition-colors hover:bg-white/10 rounded-full w-6 h-6 flex items-center justify-center"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex h-96 flex-col gap-3 overflow-y-auto p-4 bg-muted/30">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center text-muted-foreground">
            <div className="mb-2 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 p-3">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <p className="text-sm font-medium text-foreground">
              Ask me to create shapes, arrange objects, or build layouts!
            </p>
            <div className="w-full max-w-sm space-y-3 text-left text-xs leading-relaxed text-muted-foreground/80">
              <div>
                <p className="font-semibold text-foreground">Creation Commands</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>"Create a red circle at position 100, 200"</li>
                  <li>"Add a text layer that says 'Hello World'"</li>
                  <li>"Make a 200x300 rectangle"</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground">Manipulation Commands</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>"Move the blue rectangle to the center"</li>
                  <li>"Resize the circle to be twice as big"</li>
                  <li>"Rotate the text 45 degrees"</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground">Layout Commands</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>"Arrange these shapes in a horizontal row"</li>
                  <li>"Create a grid of 3x3 squares"</li>
                  <li>"Space these elements evenly"</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-foreground">Complex Commands</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>"Create a login form with username and password fields"</li>
                  <li>"Build a navigation bar with 4 menu items"</li>
                  <li>"Make a card layout with title, image, and description"</li>
                </ul>
              </div>
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                message.role === "user"
                  ? "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-sm"
                  : "bg-background border border-border shadow-sm"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex flex-col gap-2 rounded-lg bg-background border border-border px-4 py-3 text-sm min-w-[200px] shadow-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="font-medium">Thinking...</span>
              </div>
              {operationProgress && (
                <div className="flex flex-col gap-1 mt-1">
                  <div className="text-xs text-muted-foreground">
                    Step {operationProgress.current} of {operationProgress.total}
                  </div>
                  <div className="text-xs font-medium">{operationProgress.operation}</div>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-cyan-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${(operationProgress.current / operationProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border p-4 bg-background">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me to create or modify shapes..."
            disabled={isLoading}
            className="flex-1 focus-visible:ring-blue-600"
            onKeyDown={(e) => {
              // Stop propagation to prevent canvas keyboard shortcuts
              e.stopPropagation()
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
            className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 transition-all"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
