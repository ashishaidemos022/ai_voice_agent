/*
  # MCP Connection Health Tracking

  ## Overview
  This migration adds health tracking capabilities for MCP server connections.
  It creates a historical log of connection health checks to monitor uptime,
  performance, and reliability of external MCP servers over time.

  ## New Tables Created

  ### 1. va_mcp_connection_health
  Stores historical health check data for MCP connections.
  - `id` (uuid, primary key) - Unique health check record identifier
  - `connection_id` (uuid, foreign key) - Reference to va_mcp_connections
  - `checked_at` (timestamptz) - Timestamp of the health check
  - `status` (text) - Status result: 'active', 'error', 'timeout'
  - `latency_ms` (integer) - Response time in milliseconds
  - `error_message` (text) - Error details if check failed
  - `metadata` (jsonb) - Additional diagnostic information

  ## Indexes
  - Composite index on (connection_id, checked_at) for time-series queries
  - Index on checked_at for cleanup operations
  - Index on status for filtering by health state

  ## Automatic Cleanup Function
  Creates a function to automatically delete health records older than 30 days
  to prevent unbounded table growth.

  ## Security Configuration
  - RLS is DISABLED for development simplicity
  - Foreign key ensures referential integrity with connections table
  - Cascading deletes when parent connection is removed

  ## Performance Considerations
  - Indexes optimize time-series queries for dashboards
  - Automatic cleanup prevents table bloat
  - BRIN index considered for very large datasets (optional)
*/

-- Create va_mcp_connection_health table
CREATE TABLE IF NOT EXISTS va_mcp_connection_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES va_mcp_connections(id) ON DELETE CASCADE,
  checked_at timestamptz DEFAULT now(),
  status text NOT NULL,
  latency_ms integer,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_va_mcp_health_connection_id_checked_at 
  ON va_mcp_connection_health(connection_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_va_mcp_health_checked_at 
  ON va_mcp_connection_health(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_va_mcp_health_status 
  ON va_mcp_connection_health(status);

-- Disable RLS for development
ALTER TABLE va_mcp_connection_health DISABLE ROW LEVEL SECURITY;

-- Create function to clean up old health records
CREATE OR REPLACE FUNCTION cleanup_old_mcp_health_records()
RETURNS void AS $$
BEGIN
  DELETE FROM va_mcp_connection_health
  WHERE checked_at < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE va_mcp_connection_health IS 'Historical health check data for MCP server connections. Records are automatically cleaned up after 30 days.';
COMMENT ON FUNCTION cleanup_old_mcp_health_records() IS 'Deletes health check records older than 30 days to prevent table bloat. Can be called manually or scheduled via pg_cron.';
