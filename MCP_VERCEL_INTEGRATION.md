# MCP Vercel Backend Integration

## Overview

The MCP (Model Context Protocol) integration uses a Vercel backend API to connect your Voice Agent to external MCP servers. This architecture provides secure, scalable access to MCP tools through HTTPS endpoints.

## Architecture

### System Architecture
```
Browser (Voice Agent) → Vercel Backend API (Node.js) → MCP Server (HTTPS)
                              ✅ Full MCP protocol support
```

The Vercel backend handles all MCP protocol communication, allowing the frontend to interact with MCP servers through simple HTTPS REST endpoints.

## Vercel API Endpoints

The following endpoints are available at `https://voiceaiagent.vercel.app`:

### 1. Create MCP Connection
**Endpoint:** `POST /api/mcp/connections`

**Request Body:**
```json
{
  "name": "Connection Name",
  "server_url": "https://your-mcp-server.com/api/mcp",
  "api_key": "your-api-key"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Connection Name",
    "server_url": "https://your-mcp-server.com/api/mcp",
    "status": "disconnected"
  }
}
```

**Important:** Server URLs must use HTTPS protocol. The backend will handle MCP protocol communication with the server.

### 2. Test MCP Connection
**Endpoint:** `POST /api/mcp/test`

**Request Body:**
```json
{
  "connection_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Connection successful",
  "execution_time_ms": 234
}
```

### 3. List MCP Tools
**Endpoint:** `POST /api/mcp/tools`

**Request Body:**
```json
{
  "connection_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "tools": [
    {
      "name": "tool_name",
      "description": "Tool description",
      "parameters": {
        "type": "object",
        "properties": {
          "param1": {
            "type": "string",
            "description": "Parameter description"
          }
        },
        "required": ["param1"]
      }
    }
  ],
  "count": 1
}
```

### 4. Execute MCP Tool
**Endpoint:** `POST /api/mcp/execute`

**Request Body:**
```json
{
  "connection_id": "uuid",
  "tool_name": "tool_name",
  "parameters": {
    "param1": "value1"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "result": "Tool execution result"
  },
  "execution_time_ms": 456
}
```

## Frontend Implementation

### Client Library

The `src/lib/mcp-api-client.ts` file provides a client library for all backend communication:

- `createConnection()` - Creates a new MCP connection
- `testConnection()` - Tests an existing connection
- `listTools()` - Lists available tools from an MCP server
- `executeTool()` - Executes a tool on an MCP server

**Key Features:**
- Type-safe interfaces for all requests and responses
- Automatic error categorization (network, timeout, auth, connection, unknown)
- Consistent error handling across all methods
- Configurable base URL via environment variable

### MCP Client

The `src/lib/mcp-client.ts` wrapper provides a higher-level interface:

```typescript
import { MCPClient } from './mcp-client';

// Create client for a connection
const client = new MCPClient(connection);

// Test connection and fetch tools
const result = await client.testConnection();

// Execute a tool
const response = await client.executeTool({
  tool_name: 'example_tool',
  parameters: { param1: 'value1' }
});
```

### Environment Configuration

Add to your `.env` file:

```env
# Existing variables
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_OPENAI_API_KEY=your-openai-api-key

# Vercel backend URL
VITE_MCP_API_BASE_URL=https://voiceaiagent.vercel.app
```

The `VITE_MCP_API_BASE_URL` environment variable configures the base URL for the Vercel backend API.

## Database Schema

The database schema uses Supabase for data persistence:

### Tables
- `va_mcp_connections` - Stores MCP server connection configurations
- `va_mcp_tools` - Stores tool definitions from MCP servers
- `va_mcp_connection_health` - Tracks connection health metrics
- `va_mcp_tool_usage` - Records tool execution statistics

All data persistence operations (connection CRUD, tool syncing, usage tracking) use Supabase through the frontend.

## User Flow

### Adding a New MCP Connection

1. User clicks "Add New MCP Connection"
2. User fills in:
   - Connection Name
   - Server URL (must start with `https://`)
   - API Key
3. User clicks "Test Connection" (optional but recommended)
   - Creates temporary connection via Vercel API
   - Tests connection
   - Deletes temporary connection
   - Shows success/error feedback
4. User clicks "Add Connection"
   - Calls Vercel API to create connection
   - Backend stores connection in Supabase database
   - Frontend syncs tools from the MCP server
   - Tools are stored in Supabase database
5. Connection appears in the list with status indicator

### Using MCP Tools

1. Frontend loads enabled connections from Supabase
2. Frontend loads tools for active connections from Supabase
3. Tools are registered in the tools registry
4. Voice agent receives tool schemas
5. When agent wants to execute a tool:
   - Frontend calls `mcpApiClient.executeTool()`
   - Vercel backend communicates with MCP server via HTTPS
   - Backend executes tool via MCP protocol
   - Backend returns result to frontend
   - Frontend records usage in Supabase database
   - Result is returned to voice agent

## MCP Server Requirements

### Server URL Format

MCP servers must expose HTTPS endpoints. Valid URL formats:

✅ `https://api.example.com/mcp`
✅ `https://my-mcp-server.com/api/tools`
✅ `https://mcp.myservice.io/v1`

❌ `wss://server.com/mcp` (WebSocket - not supported)
❌ `ws://localhost:3000/mcp` (WebSocket - not supported)
❌ `http://insecure.com/mcp` (HTTP - not supported, must be HTTPS)

### Protocol Support

The Vercel backend handles MCP protocol communication. Your MCP server should:
- Accept HTTPS requests
- Implement the MCP protocol specification
- Support JSON-RPC 2.0 message format
- Provide authentication via API key or similar mechanism

## Benefits of Vercel Backend

### 1. Secure Architecture
- API keys never exposed to the browser
- All MCP communication handled server-side
- HTTPS-only for maximum security

### 2. Scalability
- Vercel's serverless functions scale automatically
- Better handling of concurrent connections
- No connection pooling complexity in frontend

### 3. Simplified Frontend
- Simple REST API calls instead of protocol handling
- No complex protocol management
- Cleaner error handling

### 4. Protocol Abstraction
- Backend handles MCP protocol details
- Frontend only needs to know about REST endpoints
- Easier to update protocol implementation

## Error Handling

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "execution_time_ms": 123
}
```

### Error Response
```json
{
  "success": false,
  "error": "Human-readable error message",
  "error_type": "network|timeout|auth|connection|unknown"
}
```

### Error Types

- **network** - Failed to reach the backend API
- **timeout** - Request took too long to complete
- **auth** - Authentication failed (invalid API key)
- **connection** - Failed to establish connection with MCP server
- **unknown** - Unspecified error

## Testing the Integration

### 1. Test Connection Creation
```javascript
const response = await fetch('https://voiceaiagent.vercel.app/api/mcp/connections', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Test Connection',
    server_url: 'https://your-mcp-server.com/api/mcp',
    api_key: 'your-api-key'
  })
});
const data = await response.json();
console.log(data);
```

### 2. Test Connection
```javascript
const response = await fetch('https://voiceaiagent.vercel.app/api/mcp/test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connection_id: 'your-connection-id'
  })
});
const data = await response.json();
console.log(data);
```

### 3. List Tools
```javascript
const response = await fetch('https://voiceaiagent.vercel.app/api/mcp/tools', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connection_id: 'your-connection-id'
  })
});
const data = await response.json();
console.log(data);
```

### 4. Execute Tool
```javascript
const response = await fetch('https://voiceaiagent.vercel.app/api/mcp/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    connection_id: 'your-connection-id',
    tool_name: 'example_tool',
    parameters: { param1: 'value1' }
  })
});
const data = await response.json();
console.log(data);
```

## Troubleshooting

### Connection Test Fails

**Error: "Network error - unable to reach API"**
- Check internet connectivity
- Verify Vercel backend is accessible at `https://voiceaiagent.vercel.app`
- Check for firewall or proxy blocking requests

**Error: "Connection failed"**
- Verify MCP server URL starts with `https://`
- Check MCP server is running and accessible
- Verify API key is correct
- Test MCP server directly with curl or Postman

**Error: "Connection timed out"**
- MCP server may be slow or unresponsive
- Network latency issues
- Check MCP server logs

### Tools Not Loading

1. Check connection status in UI (should be "active")
2. Verify connection is enabled (toggle power button)
3. Click sync button to refresh tools
4. Check browser console for errors
5. Verify tools exist in Supabase `va_mcp_tools` table

### Tool Execution Fails

1. Check `va_mcp_tool_usage` table for error messages
2. Verify connection is still active
3. Test connection manually in MCP panel
4. Check Vercel backend logs (if accessible)
5. Verify tool parameters match expected schema

## Security Considerations

### API Keys
- API keys are stored in Supabase database
- Keys are sent to Vercel backend for MCP operations
- Keys are not exposed in browser DevTools
- Backend handles all MCP authentication

### Connection Validation
- All requests validate connection ownership
- Disabled connections cannot be used
- Connection status checked before operations

### HTTPS Only
- All communication uses HTTPS
- No unencrypted data transmission
- MCP servers must support HTTPS

## Best Practices

### 1. Connection Management
- Use descriptive connection names
- Test connections before saving
- Regularly sync tools to stay updated
- Disable unused connections
- Monitor connection health metrics

### 2. URL Configuration
- Always use `https://` protocol
- Include full path to MCP endpoint
- Avoid query parameters in base URL
- Use production URLs for production deployments

### 3. Error Handling
- Check `success` field in all responses
- Display user-friendly error messages
- Log detailed errors for debugging
- Implement retry logic for transient failures

### 4. Performance
- Backend handles connection optimization
- Monitor execution times in usage table
- Optimize slow tools on MCP server side
- Consider caching for frequently used tools

## Conclusion

The Vercel backend integration provides:

✅ Secure HTTPS-only architecture
✅ Simple REST API for frontend
✅ Full MCP protocol support
✅ Scalable serverless infrastructure
✅ Seamless integration with existing frontend
✅ No changes to database schema
✅ Production-ready reliability

This architecture is production-ready and provides a solid foundation for integrating external MCP tools into your Voice Agent application.
