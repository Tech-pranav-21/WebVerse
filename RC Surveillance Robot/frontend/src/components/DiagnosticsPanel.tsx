/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Network,
  Terminal,
  Cpu,
} from 'lucide-react';
import { CameraConfig, ConnectionProbeResult, StreamHealth } from '../types/camera';
import { resolveCameraUrl } from '../config/cameraConfig';
import { hostOrigin, isMixedContentRestricted, probeCameraConnection } from '../services/connectionService';
import { StreamHealthCard } from './StreamHealthCard';
import { DiagnosticsSummaryCard } from './DiagnosticsSummaryCard';
import { ResponseTimeCard } from './ResponseTimeCard';
import { ConnectionHistoryCard } from './ConnectionHistoryCard';
import { DiagnosticsOverview } from './DiagnosticsOverview';
import { BTN_GHOST, BTN_SECONDARY, Code, Disclosure, Panel, StatusBadge } from './ui';

interface DiagnosticsPanelProps {
  config: CameraConfig;
  /** Live stream state from the connection manager (separate from the one-off probes below). */
  health: StreamHealth;
  onReconnect: () => void;
  /** Phase 2: one camera-reachability measurement. Returns false if one is already running. */
  onMeasureHost: () => boolean;
  /** Phase 2: opt-in periodic measurement; null switches it off. */
  onSetAutoMeasure: (intervalMs: number | null) => void;
  /** Phase 2: erase the connection history. */
  onClearHistory: () => void;
  onOpenSettings: () => void;
  onOpenNetworkGuide: () => void;
}

export interface DiagnosticTestItem {
  id: string;
  name: string;
  description: string;
  url: string;
  kind: 'host' | 'image';
  result?: ConnectionProbeResult;
  status: 'idle' | 'running' | 'passed' | 'failed' | 'unconfigured';
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  config,
  health,
  onReconnect,
  onMeasureHost,
  onSetAutoMeasure,
  onClearHistory,
  onOpenSettings,
  onOpenNetworkGuide,
}) => {
  // The reachability request goes to the camera's base address. If the video comes from the same
  // host:port, the two compete for one small web server (see ResponseTimeCard).
  const probeTarget = hostOrigin(config.baseUrl);
  const probeSharesStreamOrigin =
    probeTarget !== '' &&
    Boolean(config.streamPath?.trim()) &&
    hostOrigin(resolveCameraUrl(config.baseUrl, config.streamPath)) === probeTarget;

  const getInitialTests = (cfg: CameraConfig): DiagnosticTestItem[] => [
    {
      id: 'base-ping',
      name: 'Host reachability probe',
      description: 'Tests if the ESP32-CAM host IP responds to network requests.',
      url: cfg.baseUrl,
      kind: 'host',
      status: 'idle',
    },
    {
      id: 'snapshot-probe',
      name: 'Snapshot frame endpoint (/capture)',
      description: 'Tests if single JPEG frames can be acquired and decoded by the browser image engine.',
      url: resolveCameraUrl(cfg.baseUrl, cfg.snapshotPath || '/capture'),
      kind: 'image',
      status: 'idle',
    },
    {
      id: 'stream-probe',
      name: 'Video stream route probe',
      description: 'Tests whether the continuous MJPEG stream path is configured and delivers frames.',
      url: cfg.streamPath ? resolveCameraUrl(cfg.baseUrl, cfg.streamPath) : '',
      kind: 'image',
      status: cfg.streamPath ? 'idle' : 'unconfigured',
    },
  ];

  const [tests, setTests] = useState<DiagnosticTestItem[]>(() =>
    getInitialTests(config)
  );

  const [isRunningAll, setIsRunningAll] = useState(false);
  // The detailed cards (summary, stream health, response time, history, probes, console) open on demand.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] Diagnostics initialized for target: ${config.baseUrl}`,
  ]);

  // Guards against stale async results. A probe result is applied only if
  //  - the panel is still mounted,
  //  - the camera settings it was started with are still current (epoch), and
  //  - no newer run of the same test has started (per-test run id).
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const controllersRef = useRef(new Set<AbortController>());
  const runIdsRef = useRef<Record<string, number>>({});

  const abortAllProbes = () => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current++;
      abortAllProbes();
    };
  }, []);

  // Synchronize tests when config changes: drop results that belong to the old settings
  useEffect(() => {
    epochRef.current++;
    abortAllProbes();
    runIdsRef.current = {};
    setIsRunningAll(false);
    setTests(getInitialTests(config));
    addLog(`Configuration updated: Base URL=${config.baseUrl}, Stream=${config.streamPath || '(Unset)'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl, config.streamPath, config.snapshotPath]);

  const addLog = (message: string) => {
    setDiagnosticLogs((prev) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev.slice(0, 40),
    ]);
  };

  /** Runs one probe. Returns false if its result was discarded as stale. */
  const runTest = async (currentTest: DiagnosticTestItem): Promise<boolean> => {
    const testId = currentTest.id;

    if (!currentTest.url) {
      addLog(`[SKIP] ${currentTest.name}: Route is not configured.`);
      setTests((prev) =>
        prev.map((t) => (t.id === testId ? { ...t, status: 'unconfigured' } : t))
      );
      return true;
    }

    const epoch = epochRef.current;
    const runId = (runIdsRef.current[testId] ?? 0) + 1;
    runIdsRef.current[testId] = runId;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    const isCurrent = () =>
      mountedRef.current && epoch === epochRef.current && runIdsRef.current[testId] === runId;

    setTests((prev) =>
      prev.map((t) => (t.id === testId ? { ...t, status: 'running' } : t))
    );
    addLog(`Probing ${currentTest.name} at ${currentTest.url}...`);

    let result: ConnectionProbeResult;
    try {
      result = await probeCameraConnection(currentTest.url, 4000, currentTest.kind, controller.signal);
    } finally {
      controllersRef.current.delete(controller);
    }

    if (!isCurrent()) return false; // settings changed, panel closed, or a newer run replaced this one

    setTests((prev) =>
      prev.map((t) =>
        t.id === testId
          ? {
              ...t,
              status: result.success ? 'passed' : 'failed',
              result,
            }
          : t
      )
    );

    if (result.success) {
      addLog(
        `[PASS] ${currentTest.name} succeeded (${result.latencyMs}ms via ${result.probeType})`
      );
    } else {
      addLog(`[FAIL] ${currentTest.name}: ${result.errorMessage || 'Failed to connect'}`);
    }
    return true;
  };

  const runSingleTest = (testId: string) => {
    const test = tests.find((t) => t.id === testId);
    if (test) void runTest(test);
  };

  const runAllTests = async () => {
    const epoch = epochRef.current;
    setIsRunningAll(true);
    addLog('--- Beginning Full Diagnostic Suite ---');

    for (const test of tests) {
      if (test.status === 'unconfigured' && !test.url) {
        addLog(`[INFO] Skipping ${test.name}: Stream endpoint is not configured.`);
        continue;
      }
      const applied = await runTest(test);
      // Stop the suite if the settings changed or the panel closed while it was running.
      if (epoch !== epochRef.current || !mountedRef.current) return;
      if (!applied) break; // replaced by a newer run of the same test: stop, but release the button

    }

    if (epoch === epochRef.current && mountedRef.current) {
      addLog('--- Diagnostic Suite Completed ---');
      setIsRunningAll(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* The page at a glance: one line per check, with Run Full Test, Detailed Logs and Copy Report */}
      <DiagnosticsOverview
        health={health}
        config={config}
        tests={tests}
        isRunningAll={isRunningAll}
        onRunAll={runAllTests}
        probeSharesStreamOrigin={probeSharesStreamOrigin}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
      />

      {detailsOpen && (
      <div id="diagnostics-details" className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2 items-start">
        {/* Left: the answer first (what is known now), then the checks you can run */}
        <div className="space-y-4 min-w-0">
          {/* Phase 2: one summary that keeps host reachability, stream state and recovery apart */}
          <DiagnosticsSummaryCard
            health={health}
            config={config}
            probeSharesStreamOrigin={probeSharesStreamOrigin}
          />

          {/* One-off probes */}
          <Panel
            id="probes"
            title="Connection probes"
            icon={Network}
            description="One-off checks that run only when you press a button (Run Full Test runs all three). They answer “does this address respond right now?” A failing probe does not mean the live stream failed (the stream state is in Stream health), and a passing one does not show that video is flowing. A probe that opens the stream URL can be refused by a camera that serves one viewer at a time while the Dashboard is open."
          >
            <ul className="divide-y divide-line rounded-md border border-line">
              {tests.map((test) => (
                <li key={test.id} className="p-3 sm:p-4 flex flex-col @lg:flex-row @lg:items-start @lg:justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-slate-100">{test.name}</span>
                      {test.status === 'passed' && (
                        <StatusBadge
                          tone="good"
                          title="Time the browser waited for this one request to finish. Not Wi-Fi latency."
                        >
                          Passed ({test.result?.latencyMs}ms)
                        </StatusBadge>
                      )}
                      {test.status === 'failed' && <StatusBadge tone="bad">Failed</StatusBadge>}
                      {test.status === 'running' && (
                        <StatusBadge tone="accent" busy role="status">
                          Testing...
                        </StatusBadge>
                      )}
                      {test.status === 'unconfigured' && <StatusBadge dot={false}>Route not configured</StatusBadge>}
                    </div>
                    <p className="text-[13px] text-slate-400">{test.description}</p>
                    <div className="text-xs font-mono text-slate-300 break-all">
                      Target: {test.url || '(Awaiting route configuration)'}
                    </div>

                    {test.result?.details && (
                      <div className="text-xs text-slate-200 font-mono bg-sunken border border-line p-2 rounded-md break-words">
                        {test.result.details}
                      </div>
                    )}

                    {test.result?.errorMessage && (
                      <div className="text-xs text-rose-200 font-mono bg-rose-500/10 border border-rose-500/30 p-2 rounded-md break-words">
                        {test.result.errorMessage}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => runSingleTest(test.id)}
                    disabled={test.status === 'running' || !test.url}
                    className={`${BTN_SECONDARY} shrink-0 self-start`}
                  >
                    {test.status === 'running' ? 'Testing...' : 'Test Endpoint'}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {/* Hardware & Power Advisory */}
          <Panel id="notes" title="Hardware and browser notes" icon={Cpu}>
            <Disclosure summary="ESP32-CAM power and brownout advisory">
              <p className="text-[13px] text-slate-400 leading-relaxed">
                When mounted on an RC vehicle, the ESP32-CAM requires a dedicated 5V regulated power supply providing at least{' '}
                <strong className="text-slate-100">2 Amps</strong>. If powered from weak USB or shared RC motor battery lines,
                starting the Wi-Fi camera causes voltage dips and immediate reboot (Brownout detector).
              </p>
            </Disclosure>
            <Disclosure summary="CORS and browser architecture">
              <p className="text-[13px] text-slate-400 leading-relaxed">
                Many ESP32 camera sketches send no CORS headers. Without them, <Code>fetch()</Code> from a browser script is
                blocked, while HTML <Code>&lt;img&gt;</Code> tags for video streams and snapshots still load. The optional{' '}
                <strong className="text-slate-100">Frame monitor</strong> setting reads the stream with <Code>fetch()</Code>, so
                it only works if your camera does send <Code>Access-Control-Allow-Origin</Code>.
              </p>
              <button type="button" onClick={onOpenNetworkGuide} className={BTN_GHOST}>
                Open the network and CORS guide
              </button>
            </Disclosure>
          </Panel>
        </div>

        {/* Right: live measurements and the saved record */}
        <div className="space-y-4 min-w-0">
          {/* Live stream health (from the connection manager, not a one-off probe) */}
          <StreamHealthCard
            health={health}
            isMixedContent={isMixedContentRestricted(config.baseUrl)}
            onReconnect={onReconnect}
          />

          {/* Phase 2: timing of a browser request to the camera (not Wi-Fi latency) */}
          <ResponseTimeCard
            health={health}
            baseConfigured={Boolean(config.baseUrl?.trim())}
            probeTarget={probeTarget}
            probeSharesStreamOrigin={probeSharesStreamOrigin}
            onMeasure={onMeasureHost}
            onSetAutoMeasure={onSetAutoMeasure}
          />

          {/* Phase 2: saved, de-duplicated record of what happened */}
          <ConnectionHistoryCard health={health} onClear={onClearHistory} />
        </div>
      </div>

      {/* Real-time Diagnostics Log */}
      <Panel
        id="console"
        title="Diagnostics console log"
        icon={Terminal}
        description="What the probes above did in this page session."
        actions={
          <button type="button" onClick={() => setDiagnosticLogs([])} className={BTN_SECONDARY}>
            Clear Log
          </button>
        }
      >
        <div className="max-h-48 overflow-y-auto bg-sunken border border-line rounded-md p-3 font-mono text-xs text-slate-300 space-y-1">
          {diagnosticLogs.length === 0 ? (
            <div className="text-slate-400">The log is empty.</div>
          ) : (
            diagnosticLogs.map((log, index) => (
              <div key={index} className="leading-relaxed break-words">
                {log}
              </div>
            ))
          )}
        </div>
      </Panel>
      </div>
      )}
    </div>
  );
};
