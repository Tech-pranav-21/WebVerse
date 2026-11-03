#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mock Groq API for testing the AI recognition feature WITHOUT a Groq account, an API key or the
 * internet.
 *
 * This is a MOCK. It does NOT look at the picture and does NOT run any model: it checks that the
 * request has the shape Groq documents (bearer key, chat completions, an image_url data URL holding
 * a JPEG, a strict json_schema response_format) and then returns a CANNED answer chosen by the
 * current scenario. Whatever it "recognises" is made up. Results obtained against it prove how the
 * backend and the dashboard behave; they say nothing about real Groq output.
 *
 * No dependencies. Requires Node 18+.
 *
 *   node tools/mock-groq/mock-groq.mjs [--port 8790] [--admin-port 8791] [--key mock-groq-key]
 *
 * Then start the backend against it (the key below is a fake, accepted only by this mock):
 *   GROQ_API_KEY=mock-groq-key GROQ_API_BASE_URL=http://127.0.0.1:8790/openai/v1 npm run server
 *
 * Scenarios (admin port, e.g. http://127.0.0.1:8791/__scenario?name=animal):
 *   person | animal | vehicle | multi | empty | unsure | other   canned recognitions
 *   malformed | badjson                                          model output the backend must reject
 *   ratelimit | daily                                            HTTP 429 (short wait / daily quota)
 *   error500 | auth                                              HTTP 500 / 401
 *   slow                                                         person, after a 4 s delay
 *   /__stats                                                     what the mock has seen (never the image)
 */

import http from 'node:http';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '8790' },
    'admin-port': { type: 'string', default: '8791' },
    key: { type: 'string', default: 'mock-groq-key' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const state = {
  scenario: 'person',
  total: 0,
  rejected: 0,
  last: null,
};

const obj = (label, category, description, uncertain = false) => ({ label, category, description, uncertain });

const CANNED = {
  person: { summary: 'A person is standing in the frame.', objects: [obj('person', 'person', 'An adult standing near the centre.')] },
  animal: { summary: 'A dog is in the frame.', objects: [obj('dog', 'animal', 'A medium-sized brown dog.')] },
  vehicle: { summary: 'A car is parked in view.', objects: [obj('car', 'vehicle', 'A grey hatchback.')] },
  other: { summary: 'A chair is in view.', objects: [obj('chair', 'other', 'A wooden chair.')] },
  multi: {
    summary: 'A person walks past a parked car while a dog watches.',
    objects: [obj('person', 'person', 'An adult walking left to right.'), obj('car', 'vehicle', 'A parked grey car.'), obj('dog', 'animal', 'A dog near the car.', true)],
  },
  empty: { summary: 'An empty room with nothing notable.', objects: [] },
  unsure: { summary: 'Something dark moves in the corner.', objects: [obj('shape', 'unknown', 'An unclear dark shape.', true), obj('person?', 'person', 'Might be a person, hard to tell.', true)] },
};

function completion(content) {
  return {
    id: `mock-${state.total}`,
    object: 'chat.completion',
    model: state.lastModel,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 2400, completion_tokens: 120, total_tokens: 2520 },
  };
}

const sendJson = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
};

const groqError = (res, status, message, headers = {}, code) =>
  sendJson(res, status, { error: { message, type: 'invalid_request_error', ...(code ? { code } : {}) } }, headers);

/** Check the request against what Groq documents. Returns a problem string, or null. */
function checkRequest(body, authHeader) {
  if (authHeader !== `Bearer ${opts.key}`) return { status: 401, message: 'Invalid API Key' };
  if (!body || typeof body.model !== 'string') return { status: 400, message: '`model` is required' };
  const content = body.messages?.[0]?.content;
  if (!Array.isArray(content)) return { status: 400, message: 'messages[0].content must be a list of parts' };
  const text = content.find((p) => p.type === 'text');
  const image = content.find((p) => p.type === 'image_url');
  if (!text || !image) return { status: 400, message: 'a text part and an image_url part are required' };
  const url = image.image_url?.url ?? '';
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (!match) return { status: 400, message: 'image_url must be a base64 data URL of a JPEG' };
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { status: 400, message: 'the image is not a valid JPEG' };
  if (content.filter((p) => p.type === 'image_url').length > 3) return { status: 400, message: 'at most 3 images' };
  const rf = body.response_format;
  if (rf?.type !== 'json_schema' || rf.json_schema?.strict !== true || !rf.json_schema?.schema) {
    return { status: 400, message: 'this mock expects response_format json_schema with strict true' };
  }
  if (body.reasoning_effort !== 'none') return { status: 400, message: 'this mock expects reasoning_effort "none"' };
  if (body.stream) return { status: 400, message: 'streaming is not supported with structured outputs' };
  return { bytes: bytes.length, model: body.model, hasKeyInBody: JSON.stringify(body).includes(opts.key) };
}

function handleChat(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    state.total++;
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      /* checked below */
    }
    const checked = checkRequest(body, req.headers.authorization);
    if (checked.status) {
      state.rejected++;
      state.last = { rejected: checked.message, scenario: state.scenario };
      return groqError(res, checked.status, checked.message);
    }
    state.lastModel = checked.model;
    // Never keep the picture: only facts about the request.
    state.last = { scenario: state.scenario, imageBytes: checked.bytes, model: checked.model, keyFoundInBody: checked.hasKeyInBody };

    switch (state.scenario) {
      case 'ratelimit':
        return groqError(res, 429, 'Rate limit reached for model on requests per minute (RPM): Limit 30. Please try again in 20s.', { 'retry-after': '20' });
      case 'daily':
        return groqError(res, 429, 'Rate limit reached for model on tokens per day (TPD): Limit 200000, Used 199000.', { 'retry-after': '3600' });
      case 'error500':
        return groqError(res, 500, 'The server had an error while processing your request.');
      case 'auth':
        return groqError(res, 401, 'Invalid API Key');
      case 'malformed':
        return sendJson(res, 200, completion('I can see a person near a car, I think.'));
      case 'badjson':
        return sendJson(res, 200, completion(JSON.stringify({ summary: 'ok', objects: 'a person' })));
      case 'slow':
        await new Promise((r) => setTimeout(r, 4000));
        return sendJson(res, 200, completion(JSON.stringify(CANNED.person)));
      default:
        return sendJson(res, 200, completion(JSON.stringify(CANNED[state.scenario] ?? CANNED.person)));
    }
  });
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/openai/v1/chat/completions') return handleChat(req, res);
    groqError(res, 404, 'not found');
  })
  .listen(Number(opts.port), opts.host, () => console.log(`[mock-groq] http://${opts.host}:${opts.port}/openai/v1  (MOCK: canned answers, the image is never looked at)`));

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    if (url.pathname === '/__scenario') {
      const name = url.searchParams.get('name') ?? '';
      const known = [...Object.keys(CANNED), 'malformed', 'badjson', 'ratelimit', 'daily', 'error500', 'auth', 'slow'];
      if (!known.includes(name)) return sendJson(res, 400, { error: `unknown scenario; use one of ${known.join(', ')}` });
      state.scenario = name;
      return sendJson(res, 200, { scenario: name });
    }
    if (url.pathname === '/__stats') return sendJson(res, 200, { scenario: state.scenario, total: state.total, rejected: state.rejected, last: state.last }, { 'Access-Control-Allow-Origin': '*' });
    if (url.pathname === '/__reset') {
      state.total = 0;
      state.rejected = 0;
      state.last = null;
      return sendJson(res, 200, { ok: true });
    }
    sendJson(res, 404, { error: 'not found' });
  })
  .listen(Number(opts['admin-port']), opts.host, () => console.log(`[mock-groq] admin http://${opts.host}:${opts['admin-port']}  (/__scenario?name=..., /__stats, /__reset)`));
