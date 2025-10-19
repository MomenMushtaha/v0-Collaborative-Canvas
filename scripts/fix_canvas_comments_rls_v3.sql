-- Fix RLS policies for canvas_comments table to allow deleting resolved comments
-- This migration adds a policy to allow any authenticated user to delete resolved comments

-- Drop existing DELETE policy
DROP POLICY IF EXISTS "Users can delete own comments" ON canvas_comments;

-- Create new DELETE policies
-- Policy 1: Users can delete their own comments (resolved or not)
CREATE POLICY "Users can delete own comments" ON canvas_comments
  FOR DELETE USING (auth.uid() = created_by);

-- Policy 2: Any authenticated user can delete resolved comments
CREATE POLICY "Users can delete resolved comments" ON canvas_comments
  FOR DELETE USING (resolved = true);
