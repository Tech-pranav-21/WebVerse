#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mock ESP32-CAM for testing the dashboard WITHOUT hardware.
 *
 * This is a MOCK. It imitates the wire format of the stock Arduino
 * CameraWebServer sketch (MJPEG over multipart/x-mixed-replace, snapshot at
 * /capture) and lets you trigger failure modes on demand. It does NOT model
 * Wi-Fi, power, brownouts or real ESP32 timing. Results obtained against it
 * prove how the *browser and dashboard* react to these failures; they say
 * nothing about your physical camera.
 *
 * No dependencies. Requires Node 18.3+.
 *
 *   node tools/mock-esp32-cam/mock-esp32-cam.mjs [options]
 *
 * Options
 *   --port <n>          control/snapshot port (like port 80)   default 8080
 *   --stream-port <n>   MJPEG stream port (like port 81)       default 8081
 *   --admin-port <n>    failure-injection/stats port; stays    default 8082
 *                       reachable while the "camera" is down
 *   --fps <n>           frames per second                      default 10
 *   --cors              send "Access-Control-Allow-Origin: *"  default off
 *   --single-client     serve one stream client at a time (later clients
 *                       wait in a queue, as a blocking firmware handler would)
 *
 * Then in the dashboard Settings use:
 *   Base URL:     http://localhost:8080
 *   Stream path:  :8081/stream
 *   Snapshot:     /capture
 *
 * Failure injection (open these URLs in any browser tab or use curl), all on
 * the admin port, e.g. http://localhost:8082/__chaos?action=stall
 *   /__chaos?action=stall                  stop sending frames, keep sockets open
 *   /__chaos?action=resume                 resume sending frames
 *   /__chaos?action=drop                   abruptly reset every stream socket (RST)
 *   /__chaos?action=end                    gracefully finish every stream response
 *   /__chaos?action=reboot&ms=8000         drop everything; refuse new connections for ms
 *   /__chaos?action=reboot&ms=8000&mode=blackhole
 *                                          same, but accept sockets and never answer
 *   /__chaos?action=fps&value=2            change frame rate
 *   /__chaos?action=corrupt&kind=garbage   send ONE invalid JPEG part (garbage|truncated)
 *   /__chaos?action=reset-stats            zero the counters
 *   /__stats                               JSON: open sockets, requests, frames sent
 */

import http from 'node:http';
import net from 'node:net';
import { parseArgs } from 'node:util';
import { FRAMES_BASE64 } from './frames.generated.mjs';

const { values: opts } = parseArgs({
  options: {
    port: { type: 'string', default: '8080' },
    'stream-port': { type: 'string', default: '8081' },
    'admin-port': { type: 'string', default: '8082' },
    fps: { type: 'string', default: '10' },
    cors: { type: 'boolean', default: false },
    'single-client': { type: 'boolean', default: false },
    host: { type: 'string', default: '0.0.0.0' },
  },
});

const CONTROL_PORT = Number(opts.port);
const STREAM_PORT = Number(opts['stream-port']);
const ADMIN_PORT = Number(opts['admin-port']);
const BOUNDARY = '123456789000000000000987654321'; // same as the stock sketch
const FRAMES = FRAMES_BASE64.map((b64) => Buffer.from(b64, 'base64'));

const state = {
  fps: Math.max(1, Number(opts.fps) || 10),
  stalled: false,
  corruptNext: /** @type {null | 'garbage' | 'truncated'} */ (null),
  down: /** @type {null | 'refuse' | 'blackhole'} */ (null),
  framesSent: 0,
  activeStreams: /** @type {Set<any>} */ (new Set()),
  queue: /** @type {Array<{req: any, res: any}>} */ ([]),
  requestLog: /** @type {any[]} */ ([]),
  counters: {
    control: { totalConnections: 0, totalRequests: 0 },
    stream: { totalConnections: 0, totalRequests: 0 },
  },
  sockets: { control: new Set(), stream: new Set() },
};

function log(port, req, note = '') {
  state.requestLog.push({
    t: new Date().toISOString(),
    port,
    method: req.method,
    url: req.url,
    note,
  });
  if (state.requestLog.length > 100) state.requestLog.shift();
}

function corsHeaders() {
  return opts.cors ? { 'Access-Control-Allow-Origin': '*' } : {};
}

// ---------------------------------------------------------------- streaming --

function beginStream(req, res) {
  const stream = { req, res, idx: 0, openedAt: Date.now() };
  state.activeStreams.add(stream);

  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace;boundary=${BOUNDARY}`,
    'X-Framerate': '60',
    ...corsHeaders(),
  });

  const finish = () => {
    if (!state.activeStreams.delete(stream)) return;
    startNextQueued();
  };
  res.on('close', finish);
  req.on('close', finish);
  res.on('error', finish);
}

function startNextQueued() {
  while (state.queue.length > 0 && state.activeStreams.size === 0) {
    const next = state.queue.shift();
    if (next.req.socket.destroyed) continue;
    beginStream(next.req, next.res);
  }
}

function emitFrame(stream) {
  let frame = FRAMES[stream.idx++ % FRAMES.length];
  if (state.corruptNext) {
    // Replace this frame with a broken one (declared length matches what is sent).
    frame =
      state.corruptNext === 'truncated'
        ? frame.subarray(0, Math.floor(frame.length * 0.4))
        : Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 0x41), Buffer.from([0xff, 0xd9])]);
    state.corruptNext = null;
  }
  const now = Date.now();
  const header =
    `\r\n--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n` +
    `X-Timestamp: ${Math.floor(now / 1000)}.${String((now % 1000) * 1000).padStart(6, '0')}\r\n\r\n`;
  stream.res.write(header);
  stream.res.write(frame);
  state.framesSent++;
}

let ticker = null;
function restartTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    if (state.stalled || state.down) return;
    for (const stream of state.activeStreams) {
      if (!stream.res.destroyed) emitFrame(stream);
    }
  }, Math.round(1000 / state.fps));
}
restartTicker();

function handleStream(req, res) {
  const path = (req.url || '').split('?')[0];
  if (path !== '/stream') {
    log('stream', req, 'not found');
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  state.counters.stream.totalRequests++;
  if (opts['single-client'] && state.activeStreams.size > 0) {
    log('stream', req, 'queued behind active client (single-client mode)');
    state.queue.push({ req, res });
    req.on('close', () => {
      const i = state.queue.findIndex((q) => q.req === req);
      if (i >= 0) state.queue.splice(i, 1);
    });
    return;
  }
  log('stream', req, 'stream started');
  beginStream(req, res);
}

// ------------------------------------------------------------------ control --

function jsonStats() {
  return {
    stalled: state.stalled,
    down: state.down,
    fps: state.fps,
    cors: opts.cors,
    singleClient: opts['single-client'],
    framesSent: state.framesSent,
    stream: {
      openSockets: state.sockets.stream.size,
      activeStreams: state.activeStreams.size,
      queuedRequests: state.queue.length,
      ...state.counters.stream,
    },
    control: {
      openSockets: state.sockets.control.size,
      ...state.counters.control,
    },
    recentRequests: state.requestLog.slice(-30),
  };
}

function destroyStreamSockets(graceful) {
  for (const stream of [...state.activeStreams]) {
    if (graceful) {
      stream.res.end();
    } else {
      stream.res.socket?.resetAndDestroy?.() ?? stream.res.socket?.destroy();
    }
  }
  for (const q of state.queue.splice(0)) {
    q.req.socket?.destroy();
  }
}

function handleChaos(url, res) {
  const action = url.searchParams.get('action');
  const ms = Number(url.searchParams.get('ms') || 8000);
  let message = 'ok';
  switch (action) {
    case 'stall':
      state.stalled = true;
      break;
    case 'resume':
      state.stalled = false;
      break;
    case 'drop':
      destroyStreamSockets(false);
      break;
    case 'end':
      destroyStreamSockets(true);
      break;
    case 'reboot': {
      const mode = url.searchParams.get('mode') === 'blackhole' ? 'blackhole' : 'refuse';
      state.down = mode;
      for (const s of [...state.sockets.stream, ...state.sockets.control]) {
        s.resetAndDestroy?.() ?? s.destroy();
      }
      state.activeStreams.clear();
      state.queue.length = 0;
      setTimeout(() => {
        state.down = null;
      }, ms);
      message = `down (${mode}) for ${ms} ms`;
      break;
    }
    case 'corrupt':
      state.corruptNext = url.searchParams.get('kind') === 'truncated' ? 'truncated' : 'garbage';
      break;
    case 'fps':
      state.fps = Math.max(1, Number(url.searchParams.get('value')) || 10);
      restartTicker();
      break;
    case 'reset-stats':
      state.counters.control = { totalConnections: 0, totalRequests: 0 };
      state.counters.stream = { totalConnections: 0, totalRequests: 0 };
      state.framesSent = 0;
      state.requestLog.length = 0;
      break;
    default:
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('unknown action');
      return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ action, message, ...jsonStats() }));
}

function handleAdmin(req, res) {
  const url = new URL(req.url || '/', 'http://mock');
  if (url.pathname === '/__stats') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(jsonStats()));
    return;
  }
  if (url.pathname === '/__chaos') {
    handleChaos(url, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function handleControl(req, res) {
  state.counters.control.totalRequests++;
  const url = new URL(req.url || '/', 'http://mock');
  log('control', req);
  if (url.pathname === '/capture') {
    const frame = FRAMES[Math.floor(Math.random() * FRAMES.length)];
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': frame.length,
      ...corsHeaders(),
    });
    res.end(frame);
    return;
  }
  if (url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ mock: true, framesize: 5, quality: 12 }));
    return;
  }
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<!doctype html><title>Mock ESP32-CAM</title><h1>Mock ESP32-CAM</h1>' +
        '<p>Not a real camera. See the header of mock-esp32-cam.mjs for the failure-injection URLs.</p>' +
        `<ul><li><a href="/capture">/capture</a></li><li><a href="http://${req.headers.host?.split(':')[0]}:${STREAM_PORT}/stream">:${STREAM_PORT}/stream</a></li><li><a href="http://${req.headers.host?.split(':')[0]}:${ADMIN_PORT}/__stats">admin /__stats</a></li></ul>`,
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ------------------------------------------------------------------ servers --

function makeServer(kind, handler, port) {
  const httpServer = http.createServer(handler);
  httpServer.keepAliveTimeout = 0;
  const server = net.createServer((socket) => {
    state.counters[kind].totalConnections++;
    state.sockets[kind].add(socket);
    socket.on('close', () => state.sockets[kind].delete(socket));
    socket.on('error', () => {});
    if (state.down === 'refuse') {
      socket.resetAndDestroy();
      return;
    }
    if (state.down === 'blackhole') {
      return; // hold the socket open and never answer
    }
    httpServer.emit('connection', socket);
  });
  server.listen(port, opts.host, () => {
    console.log(`[mock-esp32-cam] ${kind} server on http://${opts.host}:${port}`);
  });
}

makeServer('control', handleControl, CONTROL_PORT);
makeServer('stream', handleStream, STREAM_PORT);
http.createServer(handleAdmin).listen(ADMIN_PORT, opts.host, () => {
  console.log(`[mock-esp32-cam] admin server on http://${opts.host}:${ADMIN_PORT} (/__stats, /__chaos)`);
});
console.log(
  `[mock-esp32-cam] fps=${state.fps} cors=${opts.cors} singleClient=${opts['single-client']}  (MOCK — not a real camera)`,
);
