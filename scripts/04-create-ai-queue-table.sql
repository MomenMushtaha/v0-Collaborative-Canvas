-- Create ai_operations_queue table for managing concurrent AI requests
CREATE TABLE IF NOT EXISTS ai_operations_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  user_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  prompt TEXT NOT NULL,
  operations JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create index for faster queue queries
CREATE INDEX IF NOT EXISTS idx_ai_queue_canvas_id ON ai_operations_queue(canvas_id);
CREATE INDEX IF NOT EXISTS idx_ai_queue_status ON ai_operations_queue(status);
CREATE INDEX IF NOT EXISTS idx_ai_queue_created_at ON ai_operations_queue(created_at);

-- Enable Row Level Security
ALTER TABLE ai_operations_queue ENABLE ROW LEVEL SECURITY;

-- Policies for ai_operations_queue (allow all authenticated users to read/write)
CREATE POLICY "Allow authenticated users to read AI queue"
  ON ai_operations_queue FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to insert AI queue"
  ON ai_operations_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated users to update AI queue"
  ON ai_operations_queue FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated users to delete AI queue"
  ON ai_operations_queue FOR DELETE
  TO authenticated
  USING (true);

-- Function to clean up old completed/failed operations (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_ai_operations()
RETURNS void AS $$
BEGIN
  DELETE FROM ai_operations_queue
  WHERE (status = 'completed' OR status = 'failed')
    AND completed_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
