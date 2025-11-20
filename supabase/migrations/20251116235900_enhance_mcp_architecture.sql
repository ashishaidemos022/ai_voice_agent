/*
  # Enhanced MCP Architecture - WebSocket Support

  ## Overview
  This migration enhances the MCP architecture to support WebSocket connections
  and adds additional tracking and categorization capabilities matching
  OpenAI Agent Builder functionality.

  ## Changes Made

  ### 1. New Tables

  #### va_mcp_tool_categories
  Organizes MCP tools into logical categories for better UI organization.
  - `id` (uuid, primary key) - Category identifier
  - `name` (text) - Category display name
  - `description` (text) - Category description
  - `icon` (text) - Icon identifier for UI
  - `sort_order` (integer) - Display order

  #### va_mcp_connection_sessions
  Tracks active WebSocket sessions to MCP servers.
  - `id` (uuid, primary key) - Session identifier
  - `connection_id` (uuid, foreign key) - Reference to va_mcp_connections
  - `session_start` (timestamptz) - Session start time
  - `last_activity` (timestamptz) - Last activity timestamp
  - `is_active` (boolean) - Whether session is currently active
  - `metadata` (jsonb) - Additional session data

  #### va_mcp_tool_usage
  Analytics for tool execution patterns.
  - `id` (uuid, primary key) - Usage record identifier
  - `tool_id` (uuid, foreign key) - Reference to va_mcp_tools
  - `connection_id` (uuid, foreign key) - Reference to va_mcp_connections
  - `executed_at` (timestamptz) - Execution timestamp
  - `execution_time_ms` (integer) - Time taken to execute
  - `success` (boolean) - Whether execution succeeded
  - `error_message` (text) - Error if execution failed

  ### 2. Enhanced Columns for va_mcp_tools
  - Add `category` (text) - Tool category for organization
  - Add `icon` (text) - Icon identifier for UI display
  - Add `usage_count` (integer) - Number of times tool has been used
  - Add `last_used_at` (timestamptz) - Last execution timestamp
  - Add `average_execution_ms` (integer) - Average execution time

  ### 3. Indexes
  - Composite indexes for performance optimization
  - Time-series indexes for analytics queries

  ## Security
  - RLS remains disabled for development
  - Foreign key constraints ensure data integrity
  - Cascading deletes for cleanup
*/

CREATE TABLE IF NOT EXISTS va_mcp_tool_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text DEFAULT '',
  icon text DEFAULT 'tool',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS va_mcp_connection_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES va_mcp_connections(id) ON DELETE CASCADE,
  session_start timestamptz DEFAULT now(),
  last_activity timestamptz DEFAULT now(),
  is_active boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE(connection_id, session_start)
);

CREATE TABLE IF NOT EXISTS va_mcp_tool_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid REFERENCES va_mcp_tools(id) ON DELETE SET NULL,
  connection_id uuid NOT NULL REFERENCES va_mcp_connections(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  executed_at timestamptz DEFAULT now(),
  execution_time_ms integer,
  success boolean DEFAULT false,
  error_message text,
  session_id text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_tools' AND column_name = 'category'
  ) THEN
    ALTER TABLE va_mcp_tools ADD COLUMN category text DEFAULT 'general';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_tools' AND column_name = 'icon'
  ) THEN
    ALTER TABLE va_mcp_tools ADD COLUMN icon text DEFAULT 'tool';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_tools' AND column_name = 'usage_count'
  ) THEN
    ALTER TABLE va_mcp_tools ADD COLUMN usage_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_tools' AND column_name = 'last_used_at'
  ) THEN
    ALTER TABLE va_mcp_tools ADD COLUMN last_used_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_tools' AND column_name = 'average_execution_ms'
  ) THEN
    ALTER TABLE va_mcp_tools ADD COLUMN average_execution_ms integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'va_mcp_connections' AND column_name = 'connection_type'
  ) THEN
    ALTER TABLE va_mcp_connections ADD COLUMN connection_type text DEFAULT 'websocket';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_va_mcp_connection_sessions_connection_id ON va_mcp_connection_sessions(connection_id);
CREATE INDEX IF NOT EXISTS idx_va_mcp_connection_sessions_is_active ON va_mcp_connection_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_va_mcp_connection_sessions_last_activity ON va_mcp_connection_sessions(last_activity);

CREATE INDEX IF NOT EXISTS idx_va_mcp_tool_usage_tool_id ON va_mcp_tool_usage(tool_id);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tool_usage_connection_id ON va_mcp_tool_usage(connection_id);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tool_usage_executed_at ON va_mcp_tool_usage(executed_at);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tool_usage_tool_name ON va_mcp_tool_usage(tool_name);

CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_category ON va_mcp_tools(category);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_usage_count ON va_mcp_tools(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_last_used ON va_mcp_tools(last_used_at DESC NULLS LAST);

ALTER TABLE va_mcp_tool_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE va_mcp_connection_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE va_mcp_tool_usage DISABLE ROW LEVEL SECURITY;

INSERT INTO va_mcp_tool_categories (name, description, icon, sort_order)
VALUES
  ('Database', 'Tools for querying and managing databases', 'database', 1),
  ('API', 'Tools for calling external APIs and services', 'cloud', 2),
  ('File System', 'Tools for file operations and management', 'folder', 3),
  ('Communication', 'Tools for sending messages and notifications', 'mail', 4),
  ('Analytics', 'Tools for data analysis and reporting', 'bar-chart', 5),
  ('Utility', 'General utility and helper tools', 'wrench', 6),
  ('Custom', 'User-defined custom tools', 'sparkles', 7)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION update_tool_usage_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE va_mcp_tools
  SET
    usage_count = usage_count + 1,
    last_used_at = NEW.executed_at,
    average_execution_ms = (
      SELECT COALESCE(AVG(execution_time_ms)::integer, 0)
      FROM va_mcp_tool_usage
      WHERE tool_id = NEW.tool_id
      AND success = true
    )
  WHERE id = NEW.tool_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tool_usage_stats ON va_mcp_tool_usage;
CREATE TRIGGER trigger_update_tool_usage_stats
  AFTER INSERT ON va_mcp_tool_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_tool_usage_stats();

CREATE OR REPLACE FUNCTION cleanup_inactive_sessions()
RETURNS void AS $$
BEGIN
  UPDATE va_mcp_connection_sessions
  SET is_active = false
  WHERE last_activity < NOW() - INTERVAL '10 minutes'
  AND is_active = true;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_tool_usage()
RETURNS void AS $$
BEGIN
  DELETE FROM va_mcp_tool_usage
  WHERE executed_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;
