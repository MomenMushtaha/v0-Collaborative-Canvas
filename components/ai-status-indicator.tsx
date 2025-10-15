"use client"

import { Sparkles, Loader2 } from "lucide-react"
import type { AIQueueItem } from "@/hooks/use-ai-queue"

interface AIStatusIndicatorProps {
  isAIWorking: boolean
  currentOperation: AIQueueItem | null
  queueLength: number
}

export function AIStatusIndicator({ isAIWorking, currentOperation, queueLength }: AIStatusIndicatorProps) {
  if (!isAIWorking) return null

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-3 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 text-white shadow-lg">
        <Loader2 className="h-5 w-5 animate-spin" />
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {currentOperation ? `${currentOperation.user_name} is using AI...` : "AI is working..."}
          </span>
          {queueLength > 1 && <span className="text-xs text-white/80">{queueLength - 1} in queue</span>}
        </div>
        <Sparkles className="h-4 w-4" />
      </div>
    </div>
  )
}
