/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Activity,
  Bot,
  Camera,
  Cpu,
  Image,
  ScanSearch,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { DeploymentModeBanner, LOCAL_SETUP_GUIDE_URL } from './DeploymentModeBanner';
import { HardwareShowcase } from './HardwareShowcase';
import { Notice, Panel, StatusBadge } from './ui';

const DEMO_EVENTS = [
  ['Motion alert', 'Illustrative event: 18.4% frame change', '09:42:18'],
  ['AI scene result', 'Prerecorded example: person and desk detected', '09:42:21'],
  ['Snapshot saved', 'Illustrative browser gallery entry', '09:42:23'],
];

/** A static, key-free presentation of the dashboard. It deliberately has no controls that can contact hardware. */
export function publicContactUrl(value: string | undefined): string | null {
  const url = value?.trim() ?? '';
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

export const PublicDemoDashboard: React.FC<{ contactUrl?: string }> = ({ contactUrl }) => {
  const contact = publicContactUrl(contactUrl);
  return (
  <div className="min-h-screen text-slate-100 font-sans">
    <header className="border-b border-line bg-[#05101e]/90 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[88rem] items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#3b9bff]/50 bg-gradient-to-b from-[#1d84e8] to-[#0e3f8f]">
          <Bot className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-lg font-bold text-white sm:text-xl">RC Surveillance Robot</h1>
          <p className="text-xs text-cyan-300">Public demonstration — simulated data only</p>
        </div>
      </div>
    </header>

    <DeploymentModeBanner />

    <main className="mx-auto max-w-[88rem] space-y-6 p-4 sm:p-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.8fr)]">
        <Panel
          id="demo-camera"
          title="Camera Demonstration"
          icon={Camera}
          description="A layout preview only. No camera stream, network request, or hardware control is available in this public build."
          status={<StatusBadge tone="accent">Simulated panel</StatusBadge>}
        >
          <div className="relative aspect-video overflow-hidden rounded-lg border border-edge bg-[radial-gradient(circle_at_32%_36%,rgba(34,211,238,.25),transparent_15%),linear-gradient(125deg,#071728,#123252_52%,#071220)]">
            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-black/45 px-3 py-2 font-mono text-xs">
              <span>DEMO FRAME / NOT CAMERA FOOTAGE</span><span className="text-cyan-300">00:09:42</span>
            </div>
            <div className="absolute bottom-[18%] left-[16%] h-[39%] w-[20%] rounded-t-[45%] border-2 border-cyan-300/70 bg-cyan-300/10" />
            <div className="absolute bottom-[18%] left-[42%] h-[26%] w-[37%] rounded border border-slate-300/50 bg-slate-100/5" />
            <div className="absolute bottom-0 h-[18%] w-full bg-slate-950/60" />
            <p className="absolute bottom-3 left-3 rounded bg-black/60 px-2 py-1 text-xs text-slate-200">Illustrative indoor monitoring scene</p>
          </div>
        </Panel>

        <Panel id="demo-overview" title="Project Overview" icon={ShieldCheck} description="ESP32-CAM-based monitoring concept for local-network observation.">
          <ul className="space-y-3 text-sm leading-relaxed text-slate-300">
            <li><strong className="text-white">Camera monitoring:</strong> configurable MJPEG or still-image endpoints in Local Hardware Mode.</li>
            <li><strong className="text-white">AI scene recognition:</strong> optional Groq, Gemini, or OpenAI gateway stays local with its key.</li>
            <li><strong className="text-white">Human analysis:</strong> local YOLO pose and activity service when installed.</li>
            <li><strong className="text-white">Browser tools:</strong> motion comparison, snapshots, history, and diagnostics.</li>
          </ul>
        </Panel>
      </section>

      {/* Real Hardware Prototype & Components Showcase */}
      <HardwareShowcase />

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel id="demo-ai" title="AI Recognition Demonstration" icon={ScanSearch} description="Example result shown from a prerecorded demonstration, not a live provider call." status={<StatusBadge tone="accent">Simulated result</StatusBadge>}>
          <div className="rounded-lg border border-line bg-sunken p-3 text-sm">
            <p className="font-semibold text-white">Example: indoor workspace scene</p>
            <p className="mt-1 text-slate-300">Illustrative labels: person, desk, monitor. This result is static and no image is sent to Groq, Gemini, or OpenAI.</p>
          </div>
        </Panel>
        <Panel id="demo-motion" title="Motion Detection Demonstration" icon={Activity} description="A representative browser-side frame-comparison event." status={<StatusBadge tone="warn">Illustrative event</StatusBadge>}>
          <p className="text-sm text-slate-300">Example: 18.4% of a frame changed at a medium sensitivity threshold. It is demonstration data, not an alert from a deployed camera.</p>
        </Panel>
        <Panel id="demo-pose" title="Pose & Activity Demonstration" icon={UserCheck} description="Representative output from the optional local pose-service workflow." status={<StatusBadge tone="accent">Sample output</StatusBadge>}>
          <p className="text-sm text-slate-300">Example: one person, standing posture. Activity labels require a local Python YOLO pose service and an actual readable frame; neither runs here.</p>
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1fr_.9fr]">
        <Panel id="demo-snapshots" title="Snapshot Gallery Demonstration" icon={Image} description="Illustrative gallery state; the public demo does not store or download images." status={<StatusBadge tone="accent">3 samples</StatusBadge>}>
          <div className="grid grid-cols-3 gap-2" aria-label="Illustrative snapshot placeholders">
            {['Frame A', 'Frame B', 'Frame C'].map((label, index) => <div key={label} className="aspect-video rounded border border-edge bg-gradient-to-br from-[#123252] to-[#061220] p-2 text-xs text-slate-300">{label}<br /><span className="text-cyan-300">Demo {index + 1}</span></div>)}
          </div>
        </Panel>
        <Panel id="demo-history" title="Event History Demonstration" icon={Activity} description="A static sample timeline that explains the local dashboard's history view." status={<StatusBadge tone="accent">Simulated</StatusBadge>}>
          <ol className="space-y-2 text-sm">
            {DEMO_EVENTS.map(([title, detail, time]) => <li key={title} className="rounded-lg border border-line bg-sunken p-2.5"><span className="font-mono text-xs text-cyan-300">{time}</span><p className="font-medium text-white">{title}</p><p className="text-xs text-slate-400">{detail}</p></li>)}
          </ol>
        </Panel>
        <Panel id="demo-diagnostics" title="Diagnostics Demonstration" icon={Cpu} description="Status examples only; no host, stream, CORS, or service probe is performed." status={<StatusBadge tone="neutral">Offline by design</StatusBadge>}>
          <dl className="space-y-2 text-sm text-slate-300"><div className="flex justify-between gap-2"><dt>Robot connection</dt><dd className="text-slate-400">Not attempted</dd></div><div className="flex justify-between gap-2"><dt>AI gateway</dt><dd className="text-slate-400">Not required</dd></div><div className="flex justify-between gap-2"><dt>Pose service</dt><dd className="text-slate-400">Not required</dd></div></dl>
        </Panel>
      </section>

      <Panel id="demo-hardware" title="Hardware & Availability" icon={Cpu} description="This showcase describes the implemented software concept; it does not imply a product listing or current stock.">
        <div className="grid gap-5 md:grid-cols-2">
          <div><h3 className="font-semibold text-white">Hardware requirements</h3><p className="mt-1 text-sm leading-relaxed text-slate-300">An ESP32-CAM with compatible MJPEG/JPEG firmware, a 2.4 GHz local network, suitable power hardware, and a computer for the optional Node and Python services. Camera endpoints and CORS behavior must be verified for the specific firmware.</p></div>
          <div><h3 className="font-semibold text-white">Contact / hardware availability</h3><p className="mt-1 text-sm leading-relaxed text-slate-300">No price, stock claim, or purchase link is published. Add a verified contact method before offering hardware for sale.</p>{contact && <a className="mt-2 mr-4 inline-block text-sm text-cyan-300 underline underline-offset-2 hover:text-cyan-200" href={contact} target="_blank" rel="noreferrer noopener">Project contact</a>}<a className="mt-2 inline-block text-sm text-cyan-300 underline underline-offset-2 hover:text-cyan-200" href={LOCAL_SETUP_GUIDE_URL} target="_blank" rel="noreferrer noopener">Project setup and source</a></div>
        </div>
      </Panel>

      <Notice tone="info"><p><strong className="text-white">Local Hardware Mode is preserved.</strong> Clone the project and run the dashboard, Node AI gateway, and optional Python pose service on your own network to use a real ESP32-CAM. The public build makes no local API, localhost, or private-camera requests.</p></Notice>
    </main>
  </div>
  );
};
