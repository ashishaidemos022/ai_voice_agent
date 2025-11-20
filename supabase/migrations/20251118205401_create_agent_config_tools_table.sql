/*
  # Create Agent Configuration Tool Selection Table

  ## Overview
  This migration adds the ability to select specific tools for each agent configuration.
  Users can choose which client, server, and MCP tools are available to each AI agent.

  ## Changes Made

  ### 1. New Table: va_agent_config_tools
  Links agent configurations to their selected tools.
  - `id` (uuid, primary key) - Unique record identifier
  - `config_id` (uuid, foreign key) - Reference to va_agent_configs
  - `tool_id` (uuid, nullable) - Reference to va_mcp_tools (null for client/server tools)
  - `tool_name` (text) - Name of the tool
  - `tool_source` (text) - Source type: 'client', 'server', or 'mcp'
  - `connection_id` (uuid, nullable) - Reference to va_mcp_connections (for MCP tools)
  - `created_at` (timestamptz) - Creation timestamp

  ### 2. Indexes
  - Index on config_id for efficient lookups by configuration
  - Index on tool_name for quick tool filtering
  - Composite index on (config_id, tool_name) for uniqueness and performance

  ### 3. Security
  - RLS disabled to match existing va_ tables
  - Foreign key constraints with CASCADE delete for data integrity
  - Unique constraint on (config_id, tool_name) to prevent duplicates

  ## Notes
  - When config_id is deleted, all associated tool selections are removed
  - When tool_id is deleted (MCP tool), the tool selection entry is also removed
  - Client and server tools have null tool_id since they're not in va_mcp_tools
  - Tool selection is optional - configs without entries will use all available tools
*/

CREATE TABLE IF NOT EXISTS va_agent_config_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES va_agent_configs(id) ON DELETE CASCADE,
  tool_id uuid REFERENCES va_mcp_tools(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_source text NOT NULL CHECK (tool_source IN ('client', 'server', 'mcp')),
  connection_id uuid REFERENCES va_mcp_connections(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(config_id, tool_name)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_va_agent_config_tools_config_id ON va_agent_config_tools(config_id);
CREATE INDEX IF NOT EXISTS idx_va_agent_config_tools_tool_name ON va_agent_config_tools(tool_name);
CREATE INDEX IF NOT EXISTS idx_va_agent_config_tools_tool_source ON va_agent_config_tools(tool_source);
CREATE INDEX IF NOT EXISTS idx_va_agent_config_tools_connection_id ON va_agent_config_tools(connection_id);

-- Disable RLS to match existing va_ tables
ALTER TABLE va_agent_config_tools DISABLE ROW LEVEL SECURITY;

-- Add helpful comment
COMMENT ON TABLE va_agent_config_tools IS 'Stores tool selections for each agent configuration. Empty selections mean all tools are enabled.';
