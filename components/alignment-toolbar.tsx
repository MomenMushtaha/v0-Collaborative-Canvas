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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AlignmentType, DistributeType } from "@/lib/alignment-utils"

interface AlignmentToolbarProps {
  selectedCount: number
  onAlign: (type: AlignmentType) => void
  onDistribute: (type: DistributeType) => void
}

export function AlignmentToolbar({ selectedCount, onAlign, onDistribute }: AlignmentToolbarProps) {
  const canAlign = selectedCount >= 2
  const canDistribute = selectedCount >= 3

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
    </div>
  )
}
