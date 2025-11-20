/*
  # MCP Connections and Tools Schema

  ## Overview
  This migration creates tables to support Model Context Protocol (MCP) server connections.
  Users can configure external MCP servers that provide custom tools for the AI agent.

  ## New Tables Created

  ### 1. va_mcp_connections
  Stores MCP server connection configurations.
  - `id` (uuid, primary key) - Unique connection identifier
  - `created_at` (timestamptz) - Connection creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp
  - `name` (text) - User-friendly connection name
  - `server_url` (text) - MCP server endpoint URL
  - `api_key` (text) - Authentication key for MCP server
  - `is_enabled` (boolean) - Whether connection is active
  - `status` (text) - Connection health status: 'active', 'error', 'disconnected'
  - `last_health_check` (timestamptz) - Last successful health check
  - `metadata` (jsonb) - Additional configuration data
  - `error_message` (text) - Latest error if status is 'error'

  ### 2. va_mcp_tools
  Stores tool definitions fetched from MCP servers.
  - `id` (uuid, primary key) - Unique tool identifier
  - `connection_id` (uuid, foreign key) - Reference to va_mcp_connections
  - `tool_name` (text) - Name of the tool
  - `description` (text) - Tool description for AI context
  - `parameters_schema` (jsonb) - JSON schema for tool parameters
  - `created_at` (timestamptz) - Tool registration timestamp
  - `updated_at` (timestamptz) - Last schema update timestamp
  - `is_enabled` (boolean) - Whether tool is available for use

  ## Security Configuration
  - RLS is DISABLED on all tables for simplified development
  - Foreign key constraints ensure data integrity
  - Indexes added for efficient querying

  ## Notes
  - API keys are stored as plain text for development (should be encrypted in production)
  - Tools are automatically synchronized from MCP servers
  - Cascading deletes ensure cleanup when connections are removed
*/

-- Create va_mcp_connections table
CREATE TABLE IF NOT EXISTS va_mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  name text NOT NULL,
  server_url text NOT NULL,
  api_key text NOT NULL,
  is_enabled boolean DEFAULT true,
  status text DEFAULT 'disconnected',
  last_health_check timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  error_message text
);

-- Create va_mcp_tools table
CREATE TABLE IF NOT EXISTS va_mcp_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES va_mcp_connections(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  description text DEFAULT '',
  parameters_schema jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_enabled boolean DEFAULT true,
  UNIQUE(connection_id, tool_name)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_va_mcp_connections_is_enabled ON va_mcp_connections(is_enabled);
CREATE INDEX IF NOT EXISTS idx_va_mcp_connections_status ON va_mcp_connections(status);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_connection_id ON va_mcp_tools(connection_id);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_is_enabled ON va_mcp_tools(is_enabled);
CREATE INDEX IF NOT EXISTS idx_va_mcp_tools_tool_name ON va_mcp_tools(tool_name);

-- Disable RLS on MCP tables
ALTER TABLE va_mcp_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE va_mcp_tools DISABLE ROW LEVEL SECURITY;