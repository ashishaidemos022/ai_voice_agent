-- Supabase MCP discovery previously persisted execute_sql as a zero-argument
-- tool. The server requires a string `query`, so publish the actual contract.
UPDATE public.va_mcp_tools
SET
  parameters_schema = jsonb_build_object(
    'type', 'object',
    'properties', jsonb_build_object(
      'query', jsonb_build_object(
        'type', 'string',
        'description', 'The complete PostgreSQL query to execute.'
      )
    ),
    'required', jsonb_build_array('query'),
    'additionalProperties', false
  ),
  updated_at = now()
WHERE tool_name = 'execute_sql';
