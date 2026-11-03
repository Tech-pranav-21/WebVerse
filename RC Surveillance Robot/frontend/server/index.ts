/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { isOfficialGroqUrl, loadConfig, loadEnvFile } from './config.js';

/**
 * AI backend entry point: `npm run server` (builds, then runs this).
 *
 * Reads GROQ_API_KEY and the other settings from the environment, or from a .env file in the
 * current directory (variables that are already set win). Prints no secret and no image.
 */

loadEnvFile(resolve(process.cwd(), '.env'), process.env);
const config = loadConfig(process.env);

if (!config.apiKey) {
  console.warn('[ai-server] GROQ_API_KEY is not set: /api/ai/recognize will answer "not_configured" until it is.');
}
if (!isOfficialGroqUrl(config.groqBaseUrl)) {
  console.warn(`[ai-server] GROQ_API_BASE_URL is ${config.groqBaseUrl}, not api.groq.com. Use this only for testing with a mock.`);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
  console.warn(
    `[ai-server] Listening on ${config.host}: anyone who can reach this port can spend your Groq quota (the request limits still apply).`,
  );
}

const app = createApp({ config, log: (line) => console.log(`[ai-server] ${line}`) });
const server = http.createServer((req, res) => {
  void app.handler(req, res);
});
server.requestTimeout = 60_000;

server.listen(config.port, config.host, () => {
  console.log(
    `[ai-server] http://${config.host}:${config.port} | model ${config.model} | ${config.apiKey ? 'API key configured' : 'NO API KEY'} | ` +
      `limits ${config.ratePerMinute}/min, ${config.maxPerDay}/day, ${config.maxConcurrent} at once`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
