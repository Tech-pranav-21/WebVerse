/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  BookOpen,
  Wifi,
  ShieldAlert,
  Server,
  Cable,
  CheckCircle,
} from 'lucide-react';
import { Code, Notice, Panel } from './ui';

const BODY = 'text-[13px] leading-relaxed text-slate-300';

/** A recessed block for a procedure or a sample of what the Arduino serial monitor prints. */
const Well: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-md border border-line bg-sunken p-3.5 space-y-2">
    <h3 className="text-[13px] font-semibold text-slate-100">{title}</h3>
    {children}
  </div>
);

const CHECKLIST = [
  {
    title: 'OV2640 Ribbon Cable Lock',
    desc: 'Ensure the thin ribbon cable between the lens module and the ESP32-CAM board connector is fully seated and the black clamp is locked down.',
  },
  {
    title: 'Independent 5V 2A Power Rail',
    desc: 'Do not power the ESP32-CAM from an Arduino Uno 3.3V/5V pin or noisy RC motor lines. Use a dedicated 5V buck converter capable of 2A peak current.',
  },
  {
    title: 'Camera Model Definition',
    desc: 'In the Arduino sketch code, confirm that `#define CAMERA_MODEL_AI_THINKER` is uncommented and other camera models are commented out.',
  },
  {
    title: 'Confirmed Stream Endpoint',
    desc: 'Once the shopkeeper or robot technician provides the exact stream URL, enter it in Settings (e.g. :81/stream or /stream).',
  },
];

export const NetworkGuideView: React.FC = () => {
  return (
    <div className="space-y-4">
      <Panel
        id="guide"
        title="ESP32-CAM network, CORS and mixed-content guide"
        icon={BookOpen}
        description="Essential architectural principles and troubleshooting steps for connecting browsers to local ESP32 hardware."
      />

      {/* HTTPS vs HTTP Mixed-Content */}
      <Panel id="guide-mixed" title="The HTTPS mixed-content barrier" icon={ShieldAlert}>
        <Notice tone="warn">
          <p>
            Modern web browsers (Chrome, Edge, Firefox, Safari) enforce a strict security policy known as{' '}
            <strong className="text-white">Mixed Content Blocking</strong>. If you access this dashboard from an{' '}
            <Code>https://</Code> URL (such as a cloud preview link), the browser will refuse to load raw video streams or
            fetch data from an unencrypted local IP address like <Code>http://192.168.1.100</Code>.
          </p>
        </Notice>
        <Well title="How to run this dashboard seamlessly for local hardware">
          <ol className="list-decimal list-inside space-y-1 text-[13px] text-slate-300 leading-relaxed">
            <li>Clone or download this project to your computer.</li>
            <li>
              Run <Code>npm run dev</Code> locally.
            </li>
            <li>
              Open <Code>http://localhost:3000</Code> in your browser. Because both localhost and the ESP32-CAM are over
              unencrypted HTTP, the browser permits direct local stream rendering.
            </li>
          </ol>
        </Well>
      </Panel>

      {/* CORS Restrictions on ESP32 */}
      <Panel id="guide-cors" title="ESP32-CAM firmware and CORS behavior" icon={Server}>
        <p className={BODY}>
          Default Arduino ESP32-CAM sketches (like <Code>CameraWebServer.ino</Code>) respond to HTTP requests without
          cross-origin headers (<Code>Access-Control-Allow-Origin: *</Code>).
        </p>
        <div className="grid gap-3 @2xl:grid-cols-2">
          <Well title="JavaScript fetch / XHR">
            <p className="text-[13px] text-slate-400 leading-relaxed">
              Standard JavaScript <Code>fetch()</Code> will trigger a CORS error in the browser console.
            </p>
          </Well>
          <Well title="HTML image tags (<img>)">
            <p className="text-[13px] text-slate-400 leading-relaxed">
              HTML image elements rendering MJPEG continuous streams (<Code>:81/stream</Code>) or JPEG snapshots (
              <Code>/capture</Code>) are exempt from CORS policies and display directly.{' '}
              <span className="text-slate-300">
                Reading a frame back (Capture Still) is different: the browser only allows it if the camera sends{' '}
                <Code>Access-Control-Allow-Origin</Code> and the video is requested with CORS (Settings, Snapshot Capture).
              </span>
            </p>
          </Well>
        </div>
      </Panel>

      {/* Finding ESP32-CAM IP on your local Wi-Fi */}
      <Panel id="guide-ip" title="How to find the ESP32-CAM IP address" icon={Wifi}>
        <p className={BODY}>
          When the ESP32-CAM boots, it connects to your 2.4GHz Wi-Fi router (ESP32 does not support 5GHz Wi-Fi networks).
        </p>
        <Well title="Method A: Arduino Serial Monitor">
          <p className="text-[13px] text-slate-400 leading-relaxed">
            Open Arduino IDE, select the correct COM port, set baud rate to <Code>115200 baud</Code>, and press the{' '}
            <strong className="text-slate-100">RST (Reset)</strong> button on the ESP32-CAM. The serial output will print:
          </p>
          <div className="bg-black p-3 rounded-md font-mono text-xs leading-relaxed text-emerald-300 border border-line">
            WiFi connected.<br />
            Starting web server on port: 80<br />
            Starting stream server on port: 81<br />
            Camera Ready! Use &apos;http://192.168.1.105&apos; to connect
          </div>
        </Well>
        <Well title="Method B: Wi-Fi router admin page or the Fing app">
          <p className="text-[13px] text-slate-400 leading-relaxed">
            Log into your router (typically <Code>192.168.1.1</Code>) or use the Fing mobile app on the same Wi-Fi network.
            Search for devices with manufacturer <strong className="text-slate-100">Espressif Inc</strong>.
          </p>
        </Well>
      </Panel>

      {/* Hardware Checklist for the RC Robot */}
      <Panel id="guide-checklist" title="Pre-flight physical checklist" icon={Cable}>
        <ul className="space-y-2">
          {CHECKLIST.map((item) => (
            <li key={item.title} className="flex items-start gap-3 p-3 rounded-md border border-line bg-sunken">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[13px] leading-relaxed">
                <strong className="text-slate-100">{item.title}:</strong>{' '}
                <span className="text-slate-400">{item.desc}</span>
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
};
