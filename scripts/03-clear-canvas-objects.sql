-- Clear all canvas objects from the database
-- This will remove all shapes from all canvases
-- Use with caution: this action cannot be undone

DELETE FROM canvas_objects;

-- Optional: Also clear user presence data
DELETE FROM user_presence;

-- Verify deletion
SELECT COUNT(*) as remaining_objects FROM canvas_objects;
SELECT COUNT(*) as remaining_presence FROM user_presence;
