/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { CameraConfig, StreamHealth } from '../types/camera';
import { useNow } from '../hooks/useNow';
import { formatEventTime } from '../services/streamStatusText';
import {
  Availability,
  CapabilityItem,
  Tone,
  buildDiagnosticsSummary,
} from '../services/diagnosticsSummary';
import { Row } from './StreamHealthCard';
import { Disclosure, Panel } from './ui';

interface DiagnosticsSummaryCardProps {
  health: StreamHealth;
  config: CameraConfig;
  /** The reachability request goes to the same host:port that serves the video. */
  probeSharesStreamOrigin: boolean;
}

const TONE_BOX: Record<Tone, string> = {
  good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  bad: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  neutral: 'border-edge bg-sunken text-slate-200',
};

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
  neutral: 'text-slate-100',
};

const AVAILABILITY_CHIP: Record<Availability, { text: string; cls: string }> = {
  measured: { text: 'Measured', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  'not-measured': { text: 'Not measured yet', cls: 'bg-raised text-slate-300 border-edge' },
  unavailable: { text: 'Cannot be measured', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
};

const CAPABILITY_CHIP: Record<CapabilityItem['state'], { text: string; cls: string }> = {
  available: { text: 'Available', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  limited: { text: 'Limited', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  unavailable: { text: 'Unavailable', cls: 'bg-raised text-slate-300 border-edge' },
};

/**
 * What is known about the camera and the stream right now, with the different facts kept apart
 * (host reachable / stream connected / stalled / reconnecting / error / not measurable). The
 * copyable troubleshooting report is built from the same summary (see DiagnosticsOverview).
 */
export const DiagnosticsSummaryCard: React.FC<DiagnosticsSummaryCardProps> = ({
  health,
  config,
  probeSharesStreamOrigin,
}) => {
  const now = useNow(true, 1000);
  const context = useMemo(
    () => ({ streamPathConfigured: Boolean(config.streamPath?.trim()), probeSharesStreamOrigin }),
    [config.streamPath, probeSharesStreamOrigin],
  );
  const summary = useMemo(() => buildDiagnosticsSummary(health, context, now), [health, context, now]);

  return (
    <Panel
      id="diag-summary"
      title="Diagnostics summary"
      icon={Gauge}
      description="Camera host, video stream and recovery, kept apart. Every line says whether it was measured."
    >
      <div className={`rounded-lg border p-3 ${TONE_BOX[summary.state.tone]}`}>
        <div className="text-xs opacity-80">Video stream</div>
        <div className="text-[15px] font-semibold mt-0.5">{summary.state.label}</div>
        <p className="text-[13px] mt-1 leading-relaxed opacity-90 break-words">{summary.state.explanation}</p>
      </div>

      <dl>
        {summary.items.map((item) => (
          <Row key={item.id} label={item.label}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`${TONE_TEXT[item.tone]} ${item.id === 'error' ? 'font-mono text-xs' : ''}`}>{item.value}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-md border ${AVAILABILITY_CHIP[item.availability].cls}`}>
                {AVAILABILITY_CHIP[item.availability].text}
              </span>
            </div>
            {item.at != null && <div className="text-xs text-slate-400">at {formatEventTime(item.at, now)}</div>}
            {item.note && <div className="text-xs text-slate-400 mt-0.5">{item.note}</div>}
          </Row>
        ))}
      </dl>

      <Disclosure summary="What this page can and cannot measure">
        <ul className="space-y-3">
          {summary.capabilities.map((c) => (
            <li key={c.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-slate-100">{c.label}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-md border ${CAPABILITY_CHIP[c.state].cls}`}>
                  {CAPABILITY_CHIP[c.state].text}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{c.detail}</p>
            </li>
          ))}
        </ul>
      </Disclosure>
    </Panel>
  );
};
