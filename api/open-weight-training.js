import { authenticate, getAllowedModels } from './open-weight-chat.js';

export const config = { maxDuration: 300 };

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateTrainingRequest(body) {
  if (!plainObject(body)) throw new Error('Request body must be an object');
  const allowed = new Set(['name', 'dataset_name', 'examples', 'rank', 'alpha', 'learning_rate', 'max_steps', 'seed']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('Unknown request field');
  if (typeof body.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{2,79}$/.test(body.name)) throw new Error('Invalid job name');
  if (typeof body.dataset_name !== 'string' || body.dataset_name.length < 3 || body.dataset_name.length > 80) throw new Error('Invalid dataset name');
  if (!Array.isArray(body.examples) || body.examples.length < 6 || body.examples.length > 200) throw new Error('Dataset must contain 6–200 examples');
  const examples = body.examples.map((example) => {
    if (!plainObject(example) || !Array.isArray(example.messages) || example.messages.length < 2 || example.messages.length > 20) throw new Error('Invalid training example');
    const messages = example.messages.map((message) => {
      if (!plainObject(message) || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content || message.content.length > 20000) throw new Error('Invalid training message');
      return { role: message.role, content: message.content };
    });
    if (messages.at(-1).role !== 'assistant') throw new Error('Every training example must end with an assistant message');
    return { messages };
  });
  if (![4, 8, 16].includes(body.rank)) throw new Error('Rank must be 4, 8, or 16');
  if (!Number.isInteger(body.alpha) || body.alpha < 4 || body.alpha > 64) throw new Error('Alpha must be 4–64');
  if (!Number.isFinite(body.learning_rate) || body.learning_rate < 0.00001 || body.learning_rate > 0.002) throw new Error('Learning rate must be 0.00001–0.002');
  if (!Number.isInteger(body.max_steps) || body.max_steps < 2 || body.max_steps > 200) throw new Error('Steps must be 2–200');
  if (!Number.isInteger(body.seed) || body.seed < 0 || body.seed > 2147483647) throw new Error('Invalid seed');
  return { ...body, examples };
}

export function validateCompletionRequest(body) {
  if (!plainObject(body) || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 50) throw new Error('Invalid messages');
  const messages = body.messages.map((message) => {
    if (!plainObject(message) || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content || message.content.length > 20000) throw new Error('Invalid message');
    return { role: message.role, content: message.content };
  });
  const max_tokens = body.max_tokens ?? 256;
  const temperature = body.temperature ?? 0;
  if (!Number.isInteger(max_tokens) || max_tokens < 1 || max_tokens > 1024) throw new Error('max_tokens must be 1–1024');
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('temperature must be 0–2');
  return { messages, max_tokens, temperature };
}

function runtimeConfig(env = process.env) {
  const model = getAllowedModels().find((entry) => entry.transport === 'openai-compatible');
  if (!model?.endpoint || !env.HUGGING_FACE_TOKEN || !env.OPEN_WEIGHT_RUNTIME_KEY) throw new Error('Training runtime is unavailable');
  return { endpoint: model.endpoint, headers: { Authorization: `Bearer ${env.HUGGING_FACE_TOKEN}`, 'Content-Type': 'application/json', 'x-runtime-key': env.OPEN_WEIGHT_RUNTIME_KEY } };
}

async function runtimeFetch(url, init) {
  const deadline = Date.now() + 180000;
  let response;
  do {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (![502, 503, 504].includes(response.status) || Date.now() >= deadline) return response;
    await response.arrayBuffer().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (Date.now() < deadline);
  return response;
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  if (!await authenticate(req)) return json(res, 401, { error: 'Authentication required' });
  let runtime;
  try { runtime = runtimeConfig(); } catch (error) { return json(res, 503, { error: error instanceof Error ? error.message : 'Training runtime is unavailable' }); }
  const jobId = typeof req.query?.jobId === 'string' && /^train-[A-Za-z0-9-]+$/.test(req.query.jobId) ? req.query.jobId : null;
  const completion = req.query?.action === 'completion';
  if (completion && (!jobId || req.method !== 'POST')) return json(res, 400, { error: 'Invalid completion request' });
  let body;
  try { body = req.method === 'POST' ? (completion ? validateCompletionRequest(req.body) : validateTrainingRequest(req.body)) : undefined; }
  catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
  const path = completion ? `/v1/training/jobs/${jobId}/completions` : jobId ? `/v1/training/jobs/${jobId}` : '/v1/training/jobs';
  let upstream;
  try { upstream = await runtimeFetch(`${runtime.endpoint}${path}`, { method: req.method, headers: runtime.headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (error) { console.error('[open-weight-training] runtime failed', error instanceof Error ? error.name : error); return json(res, 502, { error: 'Training runtime request failed' }); }
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return json(res, upstream.status === 409 ? 409 : upstream.status === 404 ? 404 : 502, { error: payload.detail || `Training runtime returned HTTP ${upstream.status}` });
  return json(res, upstream.status, payload);
}
