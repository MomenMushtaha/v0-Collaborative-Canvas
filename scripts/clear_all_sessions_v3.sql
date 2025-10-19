-- Clear all active user sessions
-- This script deletes all records from the user_sessions table
-- Run this to reset all active sessions and allow fresh logins

DELETE FROM user_sessions;

-- Verify all sessions are cleared
SELECT COUNT(*) as remaining_sessions FROM user_sessions;
