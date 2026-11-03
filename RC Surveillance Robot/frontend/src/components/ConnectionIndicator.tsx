/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertCircle, Server, SlidersHorizontal, Wifi, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ConnectionStatus } from '../types/camera';
import { BadgeTone, StatusBadge } from './ui';

interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  isMixedContent?: boolean;
  className?: string;
  /** Tooltip explaining what evidence the status is based on. */
  detail?: string;
}

interface IndicatorView {
  tone: BadgeTone;
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
  busy?: boolean;
  title?: string;
}

/** One place that says how each stream status looks: colour is the hint, the words are the message. */
function viewFor(status: ConnectionStatus, detail: string | undefined): IndicatorView {
  switch (status) {
    case 'connected':
      return { tone: 'good', label: 'Connected', ariaLabel: 'Camera Connected', icon: Wifi, title: detail };
    case 'host_reachable':
      return {
        tone: 'accent',
        label: 'Host online, no stream path',
        ariaLabel: 'Host Reachable but Stream Unset',
        icon: Server,
        title: 'Camera host is responding on the network, but no continuous live-stream path is configured yet.',
      };
    case 'connecting':
      return { tone: 'accent', label: 'Connecting...', ariaLabel: 'Checking Connection', icon: Wifi, busy: true, title: detail };
    case 'reconnecting':
      return { tone: 'warn', label: 'Reconnecting...', ariaLabel: 'Camera Reconnecting', icon: Wifi, busy: true, title: detail };
    case 'unconfigured':
      return { tone: 'neutral', label: 'Not configured', ariaLabel: 'Camera Not Configured', icon: SlidersHorizontal };
    case 'error':
      return { tone: 'bad', label: 'Connection error', ariaLabel: 'Camera Connection Error', icon: AlertCircle, title: detail };
    case 'disconnected':
    default:
      return { tone: 'neutral', label: 'Disconnected', ariaLabel: 'Camera Disconnected', icon: WifiOff, title: detail };
  }
}

export const ConnectionIndicator: React.FC<ConnectionIndicatorProps> = ({
  status,
  isMixedContent = false,
  className = '',
  detail,
}) => {
  if (isMixedContent) {
    return (
      <StatusBadge
        tone="warn"
        icon={AlertCircle}
        className={className}
        title="Browser mixed-content policy blocks HTTP requests from HTTPS"
      >
        Mixed-content block
      </StatusBadge>
    );
  }

  const view = viewFor(status, detail);
  return (
    <StatusBadge
      tone={view.tone}
      busy={view.busy}
      icon={view.icon}
      className={className}
      role="status"
      aria-label={view.ariaLabel}
      title={view.title}
    >
      {view.label}
    </StatusBadge>
  );
};
