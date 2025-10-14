-- Enable realtime for canvas_objects table
ALTER TABLE canvas_objects REPLICA IDENTITY FULL;

-- Enable realtime for user_presence table  
ALTER TABLE user_presence REPLICA IDENTITY FULL;

-- Grant realtime permissions
GRANT SELECT ON canvas_objects TO authenticated;
GRANT SELECT ON user_presence TO authenticated;
