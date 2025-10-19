-- Create user_sessions table for single-session enforcement
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT one_session_per_user UNIQUE (user_id)
);

-- Create index for faster session lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id);

-- Enable Row Level Security
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Policies for user_sessions
CREATE POLICY "Users can read own sessions"
  ON user_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON user_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON user_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON user_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to clean up old sessions (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM user_sessions
  WHERE last_activity < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
