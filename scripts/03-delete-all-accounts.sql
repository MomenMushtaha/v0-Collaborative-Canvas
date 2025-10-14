-- Delete all accounts and related data (Version 3)
-- This script removes all canvas objects, user presence, and user accounts

-- Delete all canvas objects
DELETE FROM canvas_objects;

-- Delete all user presence records
DELETE FROM user_presence;

-- Delete all users from auth.users
DELETE FROM auth.users;
