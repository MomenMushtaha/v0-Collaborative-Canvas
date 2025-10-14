-- Create canvas_objects table for storing shapes
CREATE TABLE IF NOT EXISTS canvas_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL,
  type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  rotation REAL DEFAULT 0,
  fill_color TEXT DEFAULT '#3b82f6',
  stroke_color TEXT DEFAULT '#1e40af',
  stroke_width REAL DEFAULT 2,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster canvas queries
CREATE INDEX IF NOT EXISTS idx_canvas_objects_canvas_id ON canvas_objects(canvas_id);

-- Create user_presence table for multiplayer cursors
CREATE TABLE IF NOT EXISTS user_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  user_name TEXT NOT NULL,
  cursor_x REAL,
  cursor_y REAL,
  color TEXT NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for presence queries
CREATE INDEX IF NOT EXISTS idx_user_presence_canvas_id ON user_presence(canvas_id);

-- Enable Row Level Security
ALTER TABLE canvas_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Policies for canvas_objects (allow all authenticated users to read/write)
CREATE POLICY "Allow authenticated users to read canvas objects"
  ON canvas_objects FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert canvas objects"
  ON canvas_objects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update canvas objects"
  ON canvas_objects FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete canvas objects"
  ON canvas_objects FOR DELETE
  TO authenticated
  USING (true);

-- Policies for user_presence (allow all authenticated users to read/write)
CREATE POLICY "Allow authenticated users to read presence"
  ON user_presence FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert presence"
  ON user_presence FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update presence"
  ON user_presence FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete presence"
  ON user_presence FOR DELETE
  TO authenticated
  USING (true);
