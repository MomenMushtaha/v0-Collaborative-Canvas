"use client"

import {
  AlignLeft,
  AlignRight,
  AlignLeft as AlignTop,
  PanelsRightBottom as AlignBottom,
  AlignCenterHorizontal,
  AlignCenterVertical,
  StretchHorizontal as DistributeHorizontal,
  StretchVertical as DistributeVertical,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"

interface AlignmentToolbarProps {
  selectedCount: number
  onAlign: (type: AlignmentType) => void
  onDistribute: (type: DistributeType) => void
  onBringToFront?: () => void
  onSendToBack?: () => void
  onBringForward?: () => void
  onSendBackward?: () => void
}

export function AlignmentToolbar({
  selectedCount,
  onAlign,
  onDistribute,
  onBringToFront,
  onSendToBack,
  onBringForward,
  onSendBackward,
}: AlignmentToolbarProps) {
  const canAlign = selectedCount >= 2
  const canDistribute = selectedCount >= 3
  const canReorder = selectedCount >= 1

  const handleBringToFront = () => {
    console.log("[v0] AlignmentToolbar: Bring to Front clicked", { onBringToFront, selectedCount })
    onBringToFront?.()
  }

  const handleSendToBack = () => {
    console.log("[v0] AlignmentToolbar: Send to Back clicked", { onSendToBack, selectedCount })
    onSendToBack?.()
  }

  const handleBringForward = () => {
    console.log("[v0] AlignmentToolbar: Bring Forward clicked", { onBringForward, selectedCount })
    onBringForward?.()
  }

  const handleSendBackward = () => {
    console.log("[v0] AlignmentToolbar: Send Backward clicked", { onSendBackward, selectedCount })
    onSendBackward?.()
  }

  return (
    <div className="flex items-center gap-1 border-l border-border pl-2">
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("left")}
          title="Align Left"
        >
          <AlignLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("center-h")}
          title="Align Center Horizontally"
        >
          <AlignCenterHorizontal className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("right")}
          title="Align Right"
        >
          <AlignRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("top")}
          title="Align Top"
        >
          <AlignTop className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("center-v")}
          title="Align Center Vertically"
        >
          <AlignCenterVertical className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canAlign}
          onClick={() => onAlign("bottom")}
          title="Align Bottom"
        >
          <AlignBottom className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-0.5 border-l border-border pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canDistribute}
          onClick={() => onDistribute("horizontal")}
          title="Distribute Horizontally"
        >
          <DistributeHorizontal className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canDistribute}
          onClick={() => onDistribute("vertical")}
          title="Distribute Vertically"
        >
          <DistributeVertical className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-0.5 border-l border-border pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canReorder}
          onClick={handleBringToFront}
          title="Bring to Front (Ctrl+Shift+])"
        >
          <ChevronsUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canReorder}
          onClick={handleBringForward}
          title="Bring Forward (Ctrl+])"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canReorder}
          onClick={handleSendBackward}
          title="Send Backward (Ctrl+[)"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!canReorder}
          onClick={handleSendToBack}
          title="Send to Back (Ctrl+Shift+[)"
        >
          <ChevronsDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
