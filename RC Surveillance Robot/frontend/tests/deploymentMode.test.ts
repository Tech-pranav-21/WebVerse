/**
 * The public demo: how the build mode is read, that the demo page never pretends to be a live robot, and
 * that a page which is not on the user's own machine never probes that machine's localhost. The network is a
 * scripted fake (nothing is sent anywhere).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolveDeploymentMode } from '../src/services/deploymentMode';
import { createPoseClient, defaultDirectBase } from '../src/services/poseClient';
import { PoseClientError } from '../src/services/poseErrors';
import { DeploymentModeBanner, LOCAL_SETUP_GUIDE_URL } from '../src/components/DeploymentModeBanner';

const frame = () => new Blob([new Uint8Array(200).fill(7)], { type: 'image/jpeg' });
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function failure(promise: Promise<unknown>): Promise<PoseClientError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof PoseClientError, 'expected a PoseClientError');
    return err;
  }
  return assert.fail('expected the request to be rejected');
}

/** A static host: it has no /api/pose and answers every path with a plain-text 404. */
function staticHost() {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  return { urls, fetchImpl };
}

describe('deployment mode', () => {
  it('is the public demo only for the "demo" build mode', () => {
    assert.equal(resolveDeploymentMode('demo'), 'demo');
    for (const mode of [undefined, '', 'development', 'production', 'test', 'Demo', 'demo ']) {
      assert.equal(resolveDeploymentMode(mode), 'local', `build mode ${JSON.stringify(mode)}`);
    }
  });
});

describe('the public demo banner', () => {
  const markup = renderToStaticMarkup(createElement(DeploymentModeBanner));
  const text = textOf(markup);

  it('says that no robot is connected and what is missing', () => {
    assert.match(text, /Public demo: no robot is connected/);
    assert.match(text, /no camera, AI service or pose service/);
    assert.match(text, /cannot reach a camera on your private network/);
  });

  it('points to Local Hardware Mode for live operation', () => {
    assert.match(text, /Local Hardware Mode/);
    assert.match(text, /same network as the ESP32-CAM/);
  });

  it('is announced as a status and links to the setup guide safely', () => {
    assert.match(markup, /role="status"/);
    assert.ok(LOCAL_SETUP_GUIDE_URL.startsWith('https://github.com/'));
    assert.match(markup, new RegExp(`href="${LOCAL_SETUP_GUIDE_URL}"`));
    assert.match(markup, /target="_blank"/);
    assert.match(markup, /rel="noreferrer noopener"/);
  });

  it('does not claim a live connection', () => {
    assert.doesNotMatch(text, /\b(live feed|connected to the robot|online)\b/i);
  });
});

describe('the pose service fallback to localhost', () => {
  it('is used only by a page that is served from this machine', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      assert.equal(defaultDirectBase(host), 'http://127.0.0.1:8000', host);
    }
    for (const host of ['rc-demo.vercel.app', 'example.com', '192.168.1.50', 'localhost.evil.example', '']) {
      assert.equal(defaultDirectBase(host), null, host);
    }
  });

  it('keeps its long-standing default outside a browser (no page, no hostname)', () => {
    assert.equal(defaultDirectBase(undefined), 'http://127.0.0.1:8000');
  });

  it('never contacts localhost when the fallback is switched off, and reports the service as unreachable', async () => {
    const host = staticHost();
    const client = createPoseClient({ fetchImpl: host.fetchImpl, directBase: null });

    assert.equal(await client.checkHealth(), null);
    const err = await failure(client.detect(frame()));
    assert.equal(err.kind, 'unreachable');
    assert.ok(host.urls.length >= 2);
    assert.ok(
      host.urls.every((u) => u.startsWith('/api/pose/')),
      `only same-origin requests expected, got ${host.urls.join(', ')}`,
    );
  });

  it('still falls back to the direct port when one is configured', async () => {
    const host = staticHost();
    const client = createPoseClient({ fetchImpl: host.fetchImpl, directBase: 'http://127.0.0.1:8000' });
    await client.checkHealth();
    assert.deepEqual(host.urls, ['/api/pose/health', 'http://127.0.0.1:8000/health']);
  });
});
