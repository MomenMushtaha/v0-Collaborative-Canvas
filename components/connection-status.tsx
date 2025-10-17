"use client"

import { WifiOff, RefreshCw } from "lucide-react"

type ConnectionState = "online" | "reconnecting" | "offline"

interface ConnectionStatusProps {
  isConnected: boolean
  queuedOps: number
}

export function ConnectionStatus({ isConnected, queuedOps }: ConnectionStatusProps) {
  const status: ConnectionState = isConnected ? "online" : queuedOps > 0 ? "reconnecting" : "offline"

  // Don't show anything when online
  if (status === "online") {
    return null
  }

  return (
    <div
      className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg transition-all ${
        status === "reconnecting" ? "bg-yellow-500 text-yellow-950" : "bg-red-500 text-white"
      }`}
    >
      {status === "reconnecting" ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Reconnecting...</span>
          {queuedOps > 0 && (
            <span className="ml-1 rounded-full bg-yellow-950/20 px-2 py-0.5 text-xs">{queuedOps} queued</span>
          )}
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Offline</span>
        </>
      )}
    </div>
  )
}
