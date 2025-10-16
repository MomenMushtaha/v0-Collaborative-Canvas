-- Add text-specific columns to canvas_objects table
-- This enables text layer support for the AI agent

ALTER TABLE canvas_objects 
ADD COLUMN IF NOT EXISTS text_content TEXT,
ADD COLUMN IF NOT EXISTS font_size REAL DEFAULT 16,
ADD COLUMN IF NOT EXISTS font_family TEXT DEFAULT 'Arial';

-- Add comment to document the change
COMMENT ON COLUMN canvas_objects.text_content IS 'Text content for text-type objects';
COMMENT ON COLUMN canvas_objects.font_size IS 'Font size in pixels for text objects';
COMMENT ON COLUMN canvas_objects.font_family IS 'Font family name for text objects';
