-- Add selected_object_ids column to user_presence table
ALTER TABLE user_presence
ADD COLUMN IF NOT EXISTS selected_object_ids TEXT[] DEFAULT '{}';

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_user_presence_selected_objects 
ON user_presence USING GIN (selected_object_ids);
