// BharatCode model client. BharatCode exposes an OpenAI-compatible Responses API:
// https://bharatcode.ai/build. Every call asks for JSON that matches a schema.

const DEFAULT_BASE = 'https://bharatcode.ai/api/model/v1';
export const usage = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0, byStage: {} };

export function aiConfig() {
  return {
    key: process.env.BHARATCODE_API_KEY || '',
    base: (process.env.BHARATCODE_BASE_URL || DEFAULT_BASE).replace(/\/$/, ''),
    model: process.env.JAANCH_MODEL || 'qwen-3.8-27b',
  };
}

export function aiAvailable() {
  return Boolean(aiConfig().key) && !/^(1|true|yes)$/i.test(process.env.JAANCH_OFFLINE || '');
}

class AIError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pulls the text out of a Responses API payload (output_text if present, else output[].content[]). */
export function outputText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  return (data.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

/** Parses JSON from model text, tolerating ```json fences or prose around the object. */
export function parseJSON(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
    throw new AIError('model did not return JSON');
  }
}

async function post(body, { timeoutMs = 90000 } = {}) {
  const { key, base } = aiConfig();
  const res = await fetch(`${base}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, requestId: res.headers.get('x-request-id') };
}

/**
 * Sends one request and returns the parsed JSON object.
 * Retries 429/5xx (503 means "model busy") with backoff. If the server rejects the
 * structured-output options with a 400, retries once in plain JSON-by-instruction mode.
 */
export async function askJSON({ name, instructions, input, schema, maxTokens = 1500, effort = 'none', stage = name }) {
  const { model } = aiConfig();
  const strictBody = {
    model,
    instructions,
    input,
    store: false,
    max_output_tokens: maxTokens,
    reasoning: { effort },
    text: { format: { type: 'json_schema', name, schema, strict: true } },
  };
  const plainBody = {
    model,
    instructions: `${instructions}\n\nRespond with ONLY a JSON value matching this JSON Schema, no prose:\n${JSON.stringify(schema)}`,
    input,
    store: false,
    max_output_tokens: maxTokens,
  };

  let body = strictBody;
  let downgraded = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    let r;
    try {
      r = await post(body);
    } catch (err) {
      if (attempt === 3) throw countFail(new AIError(`network error: ${err.message}`));
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (r.status === 400 && !downgraded) {
      body = plainBody;
      downgraded = true;
      continue;
    }
    if (r.status === 429 || r.status >= 500) {
      if (attempt === 3) throw countFail(new AIError(`HTTP ${r.status} (model busy)`));
      await sleep(1500 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      throw countFail(new AIError(`HTTP ${r.status}: check BHARATCODE_API_KEY (get one at https://bharatcode.ai/account)`));
    }
    if (r.status >= 400) {
      const msg = r.data?.error?.message || r.data?.raw?.slice(0, 200) || 'request failed';
      throw countFail(new AIError(`HTTP ${r.status}: ${msg}${r.requestId ? ` (request ${r.requestId})` : ''}`));
    }
    track(stage, r.data.usage);
    if (r.data.status === 'incomplete') {
      throw countFail(new AIError(`output cut short (${r.data.incomplete_details?.reason || 'incomplete'})`));
    }
    return parseJSON(outputText(r.data));
  }
  throw countFail(new AIError('gave up after retries'));
}

function track(stage, u = {}) {
  usage.calls += 1;
  usage.inputTokens += u.input_tokens ?? 0;
  usage.outputTokens += u.output_tokens ?? 0;
  usage.byStage[stage] = (usage.byStage[stage] ?? 0) + 1;
}

function countFail(err) {
  usage.failures += 1;
  return err;
}

/** Cheap connectivity check used by `jaanch --check-ai`. */
export async function pingAI() {
  const out = await askJSON({
    name: 'ping',
    instructions: 'Reply with {"ok": true, "hello": "<a short hello in Hindi>"}',
    input: 'ping',
    schema: { type: 'object', additionalProperties: false, required: ['ok', 'hello'], properties: { ok: { type: 'boolean' }, hello: { type: 'string' } } },
    maxTokens: 200,
    stage: 'ping',
  });
  return out;
}
