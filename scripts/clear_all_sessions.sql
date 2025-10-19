-- Clear all active user sessions
-- This script deletes all records from the user_sessions table

DELETE FROM user_sessions;

-- Verify deletion
SELECT COUNT(*) as remaining_sessions FROM user_sessions;
