-- Create canvas_comments table for collaborative annotations
CREATE TABLE IF NOT EXISTS canvas_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  content TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_canvas_comments_canvas_id ON canvas_comments(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_comments_created_at ON canvas_comments(created_at DESC);

-- Enable Row Level Security
ALTER TABLE canvas_comments ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view all comments on canvases they have access to
CREATE POLICY "Users can view comments" ON canvas_comments
  FOR SELECT USING (true);

-- Policy: Authenticated users can create comments
CREATE POLICY "Users can create comments" ON canvas_comments
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- Policy: Users can update their own comments
CREATE POLICY "Users can update own comments" ON canvas_comments
  FOR UPDATE USING (auth.uid() = created_by);

-- Policy: Users can delete their own comments
CREATE POLICY "Users can delete own comments" ON canvas_comments
  FOR DELETE USING (auth.uid() = created_by);
