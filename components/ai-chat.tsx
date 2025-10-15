"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Send, Sparkles, Loader2 } from "lucide-react"
import type { CanvasObject } from "@/lib/types"

interface AiChatProps {
  currentObjects: CanvasObject[]
  onOperations: (operations: any[]) => void
}

interface Message {
  role: "user" | "assistant"
  content: string
}

export function AiChat({ currentObjects, onOperations }: AiChatProps) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
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

    try {
      console.log("[v0] Sending AI request:", userMessage)
      const response = await fetch("/api/ai-canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          currentObjects: currentObjects.map((obj) => ({
            type: obj.type,
            x: obj.x,
            y: obj.y,
            width: obj.width,
            height: obj.height,
            rotation: obj.rotation,
            color: obj.color,
          })),
        }),
      })

      console.log("[v0] Response status:", response.status)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        console.error("[v0] API error response:", errorData)
        throw new Error(errorData.details || errorData.error || "Failed to get AI response")
      }

      const data = await response.json()
      console.log("[v0] AI response data:", data)

      setMessages((prev) => [...prev, { role: "assistant", content: data.message }])

      if (data.operations && data.operations.length > 0) {
        console.log("[v0] AI operations:", data.operations)
        onOperations(data.operations)
      }
    } catch (error) {
      console.error("[v0] AI chat error:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${errorMessage}. Please try again.`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 text-white shadow-lg transition-all hover:shadow-xl hover:scale-105"
      >
        <Sparkles className="h-5 w-5" />
        <span className="font-medium">AI Assistant</span>
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 flex w-96 flex-col rounded-lg border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span className="font-semibold">AI Canvas Assistant</span>
        </div>
        <button onClick={() => setIsExpanded(false)} className="text-white/80 hover:text-white">
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex h-96 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Sparkles className="h-12 w-12 mb-3 text-purple-500" />
            <p className="text-sm">Ask me to create shapes, arrange objects, or build layouts!</p>
            <p className="text-xs mt-2 text-muted-foreground/60">
              Try: "Create a blue rectangle" or "Move the last shape to the center"
            </p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me to create or modify shapes..."
            disabled={isLoading}
            className="flex-1"
            onKeyDown={(e) => {
              // Stop propagation to prevent canvas keyboard shortcuts
              e.stopPropagation()
            }}
          />
          <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  )
}
