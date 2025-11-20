/*
  # Voice Agent Database Schema

  ## Overview
  This migration creates the core database structure for the Voice AI Agent application.
  All tables use the va_ prefix and have RLS disabled as requested for simplified development.

  ## New Tables Created

  ### 1. va_sessions
  Stores voice conversation sessions with metadata and status tracking.
  - `id` (uuid, primary key) - Unique session identifier
  - `created_at` (timestamptz) - Session start timestamp
  - `updated_at` (timestamptz) - Last activity timestamp
  - `session_metadata` (jsonb) - Flexible storage for session config, voice settings, etc.
  - `status` (text) - Session status: 'active', 'ended', 'error'
  - `duration_seconds` (integer) - Total conversation duration
  - `message_count` (integer) - Number of messages in session
  - `tool_execution_count` (integer) - Number of tools executed

  ### 2. va_messages
  Stores all conversation messages with audio metadata and tool call information.
  - `id` (uuid, primary key) - Unique message identifier
  - `session_id` (uuid, foreign key) - Reference to va_sessions
  - `role` (text) - Message role: 'user', 'assistant', 'system'
  - `content` (text) - Text content of the message
  - `audio_metadata` (jsonb) - Audio-related data like duration, format, etc.
  - `timestamp` (timestamptz) - Message creation time
  - `tool_calls` (jsonb) - Array of tool calls made in this message

  ### 3. va_tool_executions
  Logs every tool execution with inputs, outputs, and performance metrics.
  - `id` (uuid, primary key) - Unique execution identifier
  - `message_id` (uuid, foreign key) - Reference to va_messages
  - `session_id` (uuid, foreign key) - Reference to va_sessions for easier querying
  - `tool_name` (text) - Name of the executed tool
  - `input_params` (jsonb) - Tool input parameters
  - `output_result` (jsonb) - Tool execution result
  - `execution_time_ms` (integer) - Time taken to execute
  - `status` (text) - Execution status: 'success', 'error', 'timeout'
  - `error_message` (text) - Error details if status is 'error'
  - `executed_at` (timestamptz) - Execution timestamp
  - `execution_type` (text) - 'client' or 'server' to track where tool ran

  ## Security Configuration
  - RLS is DISABLED on all tables as requested for simplified development
  - Foreign key constraints ensure data integrity
  - Indexes added for common query patterns

  ## Notes
  - All timestamps use timestamptz for timezone awareness
  - JSONB columns allow flexible schema for metadata and tool data
  - Cascading deletes ensure cleanup when sessions are deleted
*/

-- Create va_sessions table
CREATE TABLE IF NOT EXISTS va_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  session_metadata jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'active',
  duration_seconds integer DEFAULT 0,
  message_count integer DEFAULT 0,
  tool_execution_count integer DEFAULT 0
);

-- Create va_messages table
CREATE TABLE IF NOT EXISTS va_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES va_sessions(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text DEFAULT '',
  audio_metadata jsonb DEFAULT '{}'::jsonb,
  timestamp timestamptz DEFAULT now(),
  tool_calls jsonb DEFAULT '[]'::jsonb
);

-- Create va_tool_executions table
CREATE TABLE IF NOT EXISTS va_tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES va_messages(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES va_sessions(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  input_params jsonb DEFAULT '{}'::jsonb,
  output_result jsonb DEFAULT '{}'::jsonb,
  execution_time_ms integer DEFAULT 0,
  status text DEFAULT 'success',
  error_message text,
  executed_at timestamptz DEFAULT now(),
  execution_type text DEFAULT 'client'
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_va_messages_session_id ON va_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_va_messages_timestamp ON va_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_va_tool_executions_session_id ON va_tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_va_tool_executions_message_id ON va_tool_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_va_sessions_created_at ON va_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_va_sessions_status ON va_sessions(status);

-- Disable RLS on all va_ tables as requested
ALTER TABLE va_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE va_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE va_tool_executions DISABLE ROW LEVEL SECURITY;