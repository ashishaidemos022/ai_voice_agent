/*
  # Enable RLS for MCP Connection Health Table

  ## Overview
  This migration enables Row Level Security on the va_mcp_connection_health table
  and creates policies to allow proper access for both authenticated and anonymous users.

  ## Changes Made

  ### 1. Enable RLS
  - va_mcp_connection_health: Enable RLS for secure access control

  ### 2. Security Policies Created

  #### va_mcp_connection_health policies:
  - Allow all users to SELECT health records
  - Allow all users to INSERT health records
  - Allow all users to UPDATE health records  
  - Allow all users to DELETE health records

  ## Security Notes
  - Policies allow both authenticated and anonymous access for development
  - Service role key (used by Edge Functions) bypasses RLS
  - In production, consider restricting to authenticated users only
*/

-- Enable RLS on va_mcp_connection_health
ALTER TABLE va_mcp_connection_health ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow all to select health records" ON va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to insert health records" ON va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to update health records" ON va_mcp_connection_health;
DROP POLICY IF EXISTS "Allow all to delete health records" ON va_mcp_connection_health;

-- Create policies for va_mcp_connection_health
CREATE POLICY "Allow all to select health records"
  ON va_mcp_connection_health
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY "Allow all to insert health records"
  ON va_mcp_connection_health
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY "Allow all to update health records"
  ON va_mcp_connection_health
  FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all to delete health records"
  ON va_mcp_connection_health
  FOR DELETE
  TO authenticated, anon
  USING (true);