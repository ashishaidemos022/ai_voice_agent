/*
  # Enable RLS and Create Policies for MCP Tables

  ## Overview
  This migration enables Row Level Security on MCP tables and creates policies
  to allow proper access control for authenticated and anonymous users.

  ## Changes Made

  ### 1. Enable RLS on Tables
  - va_mcp_connections: Enable RLS for secure access control
  - va_mcp_tools: Enable RLS for secure access control

  ### 2. Security Policies Created

  #### va_mcp_connections policies:
  - Allow all authenticated and anon users to SELECT connections
  - Allow all authenticated and anon users to INSERT connections
  - Allow all authenticated and anon users to UPDATE connections
  - Allow all authenticated and anon users to DELETE connections

  #### va_mcp_tools policies:
  - Allow all authenticated and anon users to SELECT tools
  - Allow all authenticated and anon users to INSERT tools
  - Allow all authenticated and anon users to UPDATE tools
  - Allow all authenticated and anon users to DELETE tools

  ## Security Notes
  - Policies allow both authenticated and anonymous access for development
  - In production, you may want to restrict to authenticated users only
  - Service role key bypasses RLS and has full access
*/

-- Enable RLS on va_mcp_connections
ALTER TABLE va_mcp_connections ENABLE ROW LEVEL SECURITY;

-- Enable RLS on va_mcp_tools
ALTER TABLE va_mcp_tools ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow all to select connections" ON va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to insert connections" ON va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to update connections" ON va_mcp_connections;
DROP POLICY IF EXISTS "Allow all to delete connections" ON va_mcp_connections;

DROP POLICY IF EXISTS "Allow all to select tools" ON va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to insert tools" ON va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to update tools" ON va_mcp_tools;
DROP POLICY IF EXISTS "Allow all to delete tools" ON va_mcp_tools;

-- Create policies for va_mcp_connections
CREATE POLICY "Allow all to select connections"
  ON va_mcp_connections
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Allow all to insert connections"
  ON va_mcp_connections
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "Allow all to update connections"
  ON va_mcp_connections
  FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all to delete connections"
  ON va_mcp_connections
  FOR DELETE
  TO authenticated, anon
  USING (true);

-- Create policies for va_mcp_tools
CREATE POLICY "Allow all to select tools"
  ON va_mcp_tools
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Allow all to insert tools"
  ON va_mcp_tools
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "Allow all to update tools"
  ON va_mcp_tools
  FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all to delete tools"
  ON va_mcp_tools
  FOR DELETE
  TO authenticated, anon
  USING (true);