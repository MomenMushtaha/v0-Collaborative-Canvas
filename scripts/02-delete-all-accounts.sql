-- Delete all canvas objects first (foreign key constraint)
DELETE FROM canvas_objects;

-- Delete all user presence records (foreign key constraint)
DELETE FROM user_presence;

-- Delete all users from auth.users
-- Note: This will cascade delete all related auth data
DELETE FROM auth.users;
