/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  Activity,
  Cpu,
  Image,
  LayoutDashboard,
  ListChecks,
  ScanSearch,
  Settings,
  UserCheck,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ActiveNavTab, CameraConfig, ConnectionStatus } from '../types/camera';
import { useNow } from '../hooks/useNow';
import { describeSpan } from '../services/streamStatusText';
import { ConnectionIndicator } from './ConnectionIndicator';

interface SidebarProps {
  activeTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
  config: CameraConfig;
  connectionStatus: ConnectionStatus;
  isMixedContent: boolean;
  /** When the current stream connection delivered its first frame, or null. */
  connectedSince: number | null;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

/** The pages of the sidebar, in order. (The network guide is reached from Diagnostics and Settings.) */
export const NAV_ITEMS: { id: ActiveNavTab; label: string; icon: LucideIcon }[] = [
  { id: 'feed', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ai', label: 'AI Detection', icon: ScanSearch },
  { id: 'pose', label: 'Pose Estimation', icon: UserCheck },
  { id: 'snapshots', label: 'Snapshots', icon: Image },
  { id: 'events', label: 'Event History', icon: ListChecks },
  { id: 'diagnostics', label: 'Diagnostics', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/** The camera address without its scheme, for the camera card. */
function hostLabel(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) return 'No address set';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`).host;
  } catch {
    return raw;
  }
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  config,
  connectionStatus,
  isMixedContent,
  connectedSince,
  isOpenMobile,
  onCloseMobile,
}) => {
  const now = useNow(connectedSince != null, 1000);

  const handleNavClick = (tabId: ActiveNavTab) => {
    onSelectTab(tabId);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#05101e] border-r border-line flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        } lg:static lg:z-auto lg:h-full lg:w-60 lg:shrink-0 lg:bg-[#05101e]/70`}
      >
        <div className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-line">
          <span className="text-sm font-semibold text-white">Menu</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="text-slate-300 hover:text-white p-2 -m-2"
            aria-label="Close navigation menu"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation: the active page is filled with the accent gradient. */}
        <nav aria-label="Dashboard pages" className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center gap-3 px-3.5 min-h-12 rounded-xl text-[15px] font-semibold text-left transition-colors ${
                  isActive
                    ? 'text-white bg-gradient-to-b from-[#1d84e8] to-[#1355c2] border border-[#3b9bff]/50 shadow-[0_0_22px_-8px_rgba(40,150,255,0.9)]'
                    : 'text-slate-300 border border-transparent hover:bg-raised hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-white' : 'text-cyan-400'}`} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* The camera this console is watching, with what is really known about it. */}
        <section aria-labelledby="sidebar-camera-title" className="m-3 p-3.5 rounded-xl bg-surface border border-line space-y-2">
          <h2 id="sidebar-camera-title" className="flex items-center gap-2 text-[13px] font-semibold text-white">
            <Cpu className="w-4 h-4 text-cyan-400" aria-hidden="true" />
            <span>ESP32-CAM</span>
          </h2>
          <ConnectionIndicator status={connectionStatus} isMixedContent={isMixedContent} className="w-fit" />
          <p className="text-xs font-mono text-slate-300 break-all" title={config.baseUrl}>
            {hostLabel(config.baseUrl)}
          </p>
          {connectedSince != null && connectionStatus === 'connected' && (
            <p className="text-xs text-slate-400">Connected for {describeSpan(now - connectedSince)}</p>
          )}
        </section>
      </aside>
    </>
  );
};
