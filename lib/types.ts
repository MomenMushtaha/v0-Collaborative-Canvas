export interface CanvasObject {
  id: string
  canvas_id: string
  type: "rectangle" | "circle" | "triangle" | "text"
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill_color: string
  stroke_color: string
  stroke_width: number
  created_by?: string
  created_at?: string
  updated_at?: string
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
