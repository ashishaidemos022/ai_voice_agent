/*
  # MCP Connections Database Schema

  1. New Tables
    - `mcp_connections`
      - `id` (uuid, primary key) - Unique connection identifier
      - `user_id` (uuid) - Reference to authenticated user
      - `name` (text) - Connection name
      - `server_url` (text) - MCP server WebSocket URL
      - `api_key` (text) - Optional API key for authentication
      - `status` (text) - connected, disconnected, or error
      - `last_connected_at` (timestamptz) - Last successful connection
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp
    
    - `mcp_tools`
      - `id` (uuid, primary key) - Unique tool identifier
      - `connection_id` (uuid) - Reference to MCP connection
      - `name` (text) - Tool name
      - `description` (text) - Tool description
      - `input_schema` (jsonb) - Tool input JSON schema
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own connections and tools
*/

CREATE TABLE IF NOT EXISTS mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  server_url text NOT NULL,
  api_key text,
  status text DEFAULT 'disconnected',
  last_connected_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE mcp_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own MCP connections"
  ON mcp_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own MCP connections"
  ON mcp_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own MCP connections"
  ON mcp_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own MCP connections"
  ON mcp_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS mcp_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  input_schema jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE mcp_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tools from own connections"
  ON mcp_tools FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mcp_connections
      WHERE mcp_connections.id = mcp_tools.connection_id
      AND mcp_connections.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create tools for own connections"
  ON mcp_tools FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mcp_connections
      WHERE mcp_connections.id = mcp_tools.connection_id
      AND mcp_connections.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tools from own connections"
  ON mcp_tools FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mcp_connections
      WHERE mcp_connections.id = mcp_tools.connection_id
      AND mcp_connections.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mcp_connections
      WHERE mcp_connections.id = mcp_tools.connection_id
      AND mcp_connections.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tools from own connections"
  ON mcp_tools FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM mcp_connections
      WHERE mcp_connections.id = mcp_tools.connection_id
      AND mcp_connections.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_mcp_connections_user_id ON mcp_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_connection_id ON mcp_tools(connection_id);
