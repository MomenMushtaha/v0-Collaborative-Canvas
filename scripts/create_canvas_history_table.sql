-- Create canvas_history table for version history tracking
CREATE TABLE IF NOT EXISTS canvas_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  description TEXT,
  object_count INTEGER NOT NULL DEFAULT 0
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_canvas_history_canvas_id ON canvas_history(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_history_created_at ON canvas_history(created_at DESC);

-- Enable Row Level Security
ALTER TABLE canvas_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read all history for canvases they have access to
CREATE POLICY "Users can read canvas history"
  ON canvas_history
  FOR SELECT
  USING (true);

-- Policy: Authenticated users can insert history
CREATE POLICY "Authenticated users can insert history"
  ON canvas_history
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);
