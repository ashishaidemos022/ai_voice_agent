# Voice AI Agent - Setup & Usage Guide

## Overview

This is a production-ready Voice AI Agent application built with:
- **OpenAI Realtime API** for full-duplex voice streaming
- **Supabase** for database persistence and Edge Functions
- **React + TypeScript** for a modern, type-safe frontend
- **Hybrid MCP Tools** (client-side and server-side execution)

## Features

### Core Functionality
- ✅ Real-time voice conversation with OpenAI GPT-4o Realtime model
- ✅ Live audio waveform visualization
- ✅ Animated agent avatar with voice-reactive pulsing
- ✅ Full conversation transcript with timestamps
- ✅ Persistent session and message logging to Supabase
- ✅ Hybrid tool execution (client + Edge Functions)

### Built-in MCP Tools

## Database Schema

All application tables use the `va_` prefix and now enforce **Row Level Security** keyed off each Supabase auth user → `va_users` record. High-level tables:

- **va_users / va_provider_keys** – profile metadata and encrypted OpenAI keys per customer. Keys can be rotated + aliased; only metadata is exposed via RLS.
- **va_agent_presets** – globally readable onboarding presets that are cloned into `va_agent_configs`.
- **va_agent_configs / va_agent_config_tools** – per-user agent definitions, plus the tool selections (client/server/MCP) for each agent. Configs reference optional `provider_key_id`.
- **va_mcp_connections / va_mcp_tools / va_mcp_connection_health** – user-scoped MCP endpoints, discovered tools, and health checks (with last sync timestamps).
- **va_sessions / va_messages / va_tool_executions** – live conversation history for each agent; triggers backfill `user_id` automatically from parent relationships to guarantee ownership isolation.

See `supabase/migrations/*2012*.sql` for the full DDL + triggers and `supabase/current_tables_nov22.json` for the flattened schema dump.

## Configuration

### Environment Variables
Located in `.env`:
```
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
VITE_OPENAI_API_KEY=<your-openai-api-key>
```

### Voice Agent Settings (Configurable via UI)
- **Voice**: Choose between Alloy, Echo, or Shimmer
- **System Instructions**: Customize AI behavior
- **Temperature**: Control response creativity (0-1)
- **Voice Activity Detection**: Auto-detect when user stops speaking
- **Model**: Uses gpt-realtime

## Usage

### User Portal & Onboarding
- Sign in with Supabase Auth (email/password or Google). Sessions persist across reloads; use the top-right menu to sign out.
- New users land in a guided flow: first add an OpenAI API key (stored encrypted/base64 in `va_provider_keys`), then clone a preset from `va_agent_presets` to create their default `va_agent_configs` row.
- The main dashboard will not unlock until a provider key exists and the user has at least one agent config (with the first one automatically marked default and connected to the saved key).
- Each screen is scoped to the signed-in user via RLS; attempting to start a session without selecting an agent presents an inline error.
- The Settings panel surfaces only the user’s configs (bound to a provider key) and notifies the parent view so preset dropdowns and the welcome hero stay in sync.

### Starting the Application

1. Click **"Start Voice Agent"** button
2. Grant microphone permissions when prompted
3. Wait for connection (green indicator)
4. Click the microphone button to start/stop recording
5. Speak naturally and watch the AI respond

### Voice Interaction Modes

#### Manual Mode (VAD Off)
- Click microphone to start recording
- Speak your message
- Click microphone again to stop and send

#### Auto Mode (VAD On)
- Click microphone once to enable
- Speak naturally - AI detects when you finish
- AI responds automatically

### Using Tools

The AI can automatically call tools during conversation. Try:
- "What time is it in Tokyo?"
- "Calculate 156 times 23"
- "Show me my recent sessions from the database"
- "What's the weather like in New York?"

Tool executions appear as badges in the transcript and are logged to the database.

## Architecture

### Frontend Structure
```
src/
├── components/          # UI components
│   ├── VoiceAgent.tsx          # Main container
│   ├── WaveformVisualizer.tsx  # Audio visualization
│   ├── AgentAvatar.tsx         # Animated avatar
│   ├── MicrophoneButton.tsx    # Recording control
│   ├── TranscriptPanel.tsx     # Conversation display
│   ├── TranscriptMessage.tsx   # Message bubbles
│   ├── ConnectionStatus.tsx    # Connection indicator
│   └── SettingsPanel.tsx       # Configuration UI
├── hooks/
│   └── useVoiceAgent.ts        # Main voice agent logic
├── lib/
│   ├── audio-manager.ts        # Web Audio API wrapper
│   ├── realtime-client.ts      # OpenAI WebSocket client
│   ├── tools-registry.ts       # MCP tool definitions
│   └── supabase.ts             # Supabase client
└── types/
    └── voice-agent.ts          # TypeScript types
```

### Edge Functions
```
supabase/functions/
├── query-database/      # Database query tool
└── external-api-call/   # External API integration
```

## Adding New Tools

### Client-Side Tool Example
```typescript
// In src/lib/tools-registry.ts
{
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter description' }
    },
    required: ['param1']
  },
  executionType: 'client',
  execute: async (params) => {
    // Your tool logic here
    return { result: 'success' };
  }
}
```

### Server-Side Tool Example
1. Create new Edge Function with `mcp__supabase__deploy_edge_function`
2. Add tool definition in `tools-registry.ts` with `executionType: 'server'`
3. Implement fetch call to your Edge Function

## Security Notes

⚠️ **IMPORTANT**: The OpenAI API key is currently in the frontend for development. For production:

1. Create a proxy Edge Function to handle OpenAI API calls
2. Generate ephemeral tokens server-side
3. Never expose API keys in client code
4. Implement proper authentication before public deployment

## Performance Considerations

- Audio buffers are properly managed to prevent memory leaks
- Transcript uses efficient rendering for long conversations
- WebSocket reconnection with exponential backoff
- Database queries are optimized with indexes
- Waveform visualization throttled to 50ms updates

## Browser Compatibility

Requires modern browsers with:
- WebSocket support
- Web Audio API
- MediaDevices.getUserMedia
- AudioContext with 24kHz sample rate

Tested on: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

## Troubleshooting

### No Audio Output
- Check browser audio permissions
- Ensure audio context is not muted
- Verify OpenAI API key has Realtime API access

### Microphone Not Working
- Grant microphone permissions in browser
- Check system microphone settings
- Try a different browser

### WebSocket Connection Fails
- Verify OpenAI API key is correct
- Check network/firewall settings
- Ensure API key has Realtime API enabled

### Tools Not Executing
- Check browser console for errors
- Verify Edge Functions are deployed
- Check Supabase connection

## Future Enhancements (RAG Add-on Ready)

The architecture supports easy addition of:
- Vector embeddings for RAG (table structure prepared)
- User authentication (Supabase Auth integration)
- Custom voice training
- Multi-language support
- Advanced analytics dashboard
- Tool marketplace/plugins

## Support

For issues or questions:
1. Check browser console for errors
2. Review Supabase logs for Edge Function issues
3. Verify all environment variables are set
4. Test with simple queries first (e.g., "Hello")

---

Built with ❤️ using OpenAI Realtime API, Supabase, and React
