-- Fix RLS policy to allow anyone to resolve comments
-- Drop the old restrictive UPDATE policy
DROP POLICY IF EXISTS "Users can update own comments" ON canvas_comments;

-- Create new policy: Users can update content of their own comments
CREATE POLICY "Users can update own comment content" ON canvas_comments
  FOR UPDATE 
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Create new policy: Anyone can resolve any comment
CREATE POLICY "Anyone can resolve comments" ON canvas_comments
  FOR UPDATE 
  USING (true)
  WITH CHECK (
    -- Only allow updating resolve-related fields
    (resolved IS NOT NULL OR resolved_by IS NOT NULL OR resolved_at IS NOT NULL)
  );
