export interface CanvasObject {
  id: string
  canvas_id: string
  type: "rectangle" | "circle" | "triangle" | "line" | "text"
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill_color: string
  stroke_color: string
  stroke_width: number
  text_content?: string
  font_size?: number
  font_family?: string
  created_by?: string
  created_at?: string
  updated_at?: string
  z?: number // z-index for layer ordering
  visible?: boolean // visibility toggle
  locked?: boolean // lock to prevent editing
  shape?: "rectangle" | "circle" | "triangle" | "line" // shape type for non-text objects
  content?: string // text content for text objects
  group_id?: string // group identifier for grouped objects
}

export interface UserPresence {
  id: string
  canvas_id: string
  user_id: string
  user_name: string
  cursor_x: number | null
  cursor_y: number | null
  color: string
  last_seen: string
}

export interface CanvasState {
  objects: CanvasObject[]
  viewportX: number
  viewportY: number
  zoom: number
}

export interface HistoryCommand {
  type: "create" | "update" | "delete"
  objectIds: string[]
  beforeState?: CanvasObject[]
  afterState?: CanvasObject[]
  timestamp: number
}

export interface CanvasGroup {
  id: string
  canvas_id: string
  name?: string
  created_at?: string
  object_ids: string[]
}
