// Vercel Serverless Function: MCP time server over HTTPS (JSON-RPC 2.0).

function formatInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.000`;
}

function getOffsetMinutes(date, timeZone) {
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit'
  });
  const tzPart = offsetFormatter
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!tzPart) return null;
  if (tzPart === 'GMT' || tzPart === 'UTC') return 0;

  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return null;

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function jsonRpcResponse(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result
  };
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  };
}

function getToolDefinition() {
  return {
    name: 'get_current_time',
    description: 'Returns current time from server clock with timezone details.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone like America/Los_Angeles (optional).'
        }
      },
      additionalProperties: false
    }
  };
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', name: 'time-mcp' }));
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  if (!payload || typeof payload !== 'object') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing JSON-RPC payload' }));
    return;
  }

  const { id = null, method, params } = payload;

  let response;

  switch (method) {
    case 'initialize': {
      response = jsonRpcResponse(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        serverInfo: {
          name: 'time-mcp',
          version: '1.0.0'
        },
        capabilities: {
          tools: {}
        }
      });
      break;
    }
    case 'tools/list': {
      response = jsonRpcResponse(id, {
        tools: [getToolDefinition()]
      });
      break;
    }
    case 'tools/call': {
      if (params?.name !== 'get_current_time') {
        response = jsonRpcError(id, -32601, `Unknown tool: ${params?.name}`);
        break;
      }
      const args = params?.arguments || {};
      const requestedTimeZone = args.timezone;
      const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

      let timeZone = fallbackTimeZone;
      if (requestedTimeZone) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: requestedTimeZone }).format(new Date());
          timeZone = requestedTimeZone;
        } catch (error) {
          response = jsonRpcResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Invalid timezone',
                  requested: requestedTimeZone,
                  fallback: fallbackTimeZone
                })
              }
            ],
            isError: true
          });
          break;
        }
      }

      const now = new Date();
      const data = {
        utc_iso: now.toISOString(),
        local_iso: formatInTimeZone(now, timeZone),
        timezone: timeZone,
        offset_minutes: getOffsetMinutes(now, timeZone),
        epoch_ms: now.getTime()
      };

      response = jsonRpcResponse(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data)
          }
        ]
      });
      break;
    }
    case 'ping': {
      response = jsonRpcResponse(id, {});
      break;
    }
    default: {
      response = jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(response));
};
