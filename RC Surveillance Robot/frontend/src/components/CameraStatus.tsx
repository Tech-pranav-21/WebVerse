/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { CameraConfig, ConnectionStatus } from '../types/camera';
import { ConnectionIndicator } from './ConnectionIndicator';
import { BTN_GHOST, Disclosure, Panel } from './ui';

interface CameraStatusProps {
  config: CameraConfig;
  streamUrl: string;
  snapshotUrl: string;
  connectionStatus: ConnectionStatus;
  isStreamConfigured: boolean;
  lastConnectionTime: number | null;
  isMixedContent: boolean;
  statusDetail?: string;
  onOpenSettings: () => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 items-baseline">
    <dt className="text-[13px] text-slate-400">{label}</dt>
    <dd className="text-[13px] font-medium text-white break-words min-w-0">{children}</dd>
  </div>
);

/** "Camera Information": what the dashboard is configured to watch and what it knows about it. */
export const CameraStatus: React.FC<CameraStatusProps> = ({
  config,
  streamUrl,
  snapshotUrl,
  connectionStatus,
  isStreamConfigured,
  lastConnectionTime,
  isMixedContent,
  statusDetail,
  onOpenSettings,
}) => {
  const formattedLastConnection = lastConnectionTime
    ? new Date(lastConnectionTime).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : 'None recorded yet';

  return (
    <Panel
      id="camera-info"
      title="Camera Information"
      actions={
        <button type="button" onClick={onOpenSettings} className={`${BTN_GHOST} !h-8 !px-2.5 text-cyan-300`}>
          Edit
        </button>
      }
    >
      <dl className="space-y-2.5">
        <Row label="Name">
          ESP32-CAM <span className="font-normal text-slate-400">(OV2640)</span>
        </Row>
        <Row label="Address">
          <span className="font-mono text-xs">{config.baseUrl || 'Unconfigured'}</span>
        </Row>
        <Row label="Stream">
          {isStreamConfigured ? (
            <span className="font-mono text-xs">{config.streamPath}</span>
          ) : (
            <span className="text-amber-300">Not configured</span>
          )}
        </Row>
        <Row label="Status">
          {connectionStatus === 'connected' && !isMixedContent ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Connected
            </span>
          ) : (
            <ConnectionIndicator status={connectionStatus} isMixedContent={isMixedContent} detail={statusDetail} />
          )}
        </Row>
      </dl>

      <Disclosure summary="Stream and snapshot URLs, last connection">
        <dl className="space-y-2.5">
          <Row label="Stream URL">
            <span className="font-mono text-xs break-all">{streamUrl || 'Awaiting stream path confirmation'}</span>
          </Row>
          <Row label="Snapshot URL">
            <span className="font-mono text-xs break-all">{snapshotUrl || 'Defaulting to /capture'}</span>
          </Row>
          <Row label="Last link">
            <span className="font-mono text-xs tabular-nums">{formattedLastConnection}</span>
          </Row>
        </dl>
      </Disclosure>
    </Panel>
  );
};
