-- Enable realtime for critical operational tables
BEGIN;
  -- Ensure the supabase_realtime publication exists
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
      CREATE PUBLICATION supabase_realtime;
    END IF;
  END $$;

  -- Add tables to realtime publication
  ALTER PUBLICATION supabase_realtime ADD TABLE workspace_presence;
  ALTER PUBLICATION supabase_realtime ADD TABLE workspace_activity_events;
  ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
COMMIT;
