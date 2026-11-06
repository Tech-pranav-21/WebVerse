import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicDemoDashboard, publicContactUrl } from '../src/components/PublicDemoDashboard';

describe('public demo dashboard', () => {
  const markup = renderToStaticMarkup(createElement(PublicDemoDashboard));
  const text = markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('labels all presentation data as simulated and does not claim live operations', () => {
    for (const label of [
      'Camera Demonstration',
      'AI Recognition Demonstration',
      'Motion Detection Demonstration',
      'Pose &amp; Activity Demonstration',
      'Snapshot Gallery Demonstration',
      'Event History Demonstration',
      'Diagnostics Demonstration',
      'Real Hardware Prototype',
      'Hardware Components',
    ]) assert.match(text, new RegExp(label));
    assert.match(text, /simulated data only/i);
    assert.match(text, /not a live provider call/i);
    assert.match(text, /makes no local API, localhost, or private-camera requests/i);
  });

  it('does not imply an unverified commercial offer or unsupported motor control', () => {
    assert.match(text, /No price, stock claim, or purchase link is published/);
    assert.doesNotMatch(text, /autonomous navigation|motor control/i);
  });

  it('integrates authentic prototype photographs and hardware components', () => {
    assert.match(markup, /\/docs\/images\/Hardware\.jpeg/);
    assert.match(markup, /\/docs\/images\/Hardware%202\.jpeg/);
    assert.match(markup, /\/docs\/images\/Hardware%20Component\.jpeg/);

    const expectedComponents = [
      'Arduino Uno',
      'ESP32-CAM',
      'HC-SR04',
      'Bluetooth Module',
      'L298N',
      'DC Motors &amp; Wheels',
      'Battery Pack &amp; Buck Converter',
      'LCD Display',
    ];
    for (const comp of expectedComponents) {
      assert.match(markup, new RegExp(comp));
    }

    assert.match(text, /From software architecture to physical implementation/);
    assert.match(text, /Visually verified on prototype/);
    assert.match(text, /Architecture specification \(not mounted in photo\)/);
  });

  it('only accepts an explicitly public contact URL', () => {
    assert.equal(publicContactUrl('mailto:project@example.com'), 'mailto:project@example.com');
    assert.equal(publicContactUrl('https://example.com/contact'), 'https://example.com/contact');
    assert.equal(publicContactUrl('javascript:alert(1)'), null);
  });
});
