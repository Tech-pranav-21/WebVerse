/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, Bot, Menu, RefreshCw, Settings } from 'lucide-react';
import { ConnectionIndicator } from './ConnectionIndicator';
import { BTN_ICON, BTN_SECONDARY } from './ui';
import { ConnectionStatus } from '../types/camera';

interface HeaderProps {
  connectionStatus: ConnectionStatus;
  isMixedContent: boolean;
  /** Opens the Settings page. */
  onOpenSettings: () => void;
  onReconnect: () => void;
  isReconnecting: boolean;
  statusDetail?: string;
  onOpenNetworkGuide: () => void;
  /** Opens the navigation drawer (shown below the lg breakpoint, where the sidebar is hidden). */
  onOpenNavigation: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  isMixedContent,
  onOpenSettings,
  onReconnect,
  isReconnecting,
  statusDetail,
  onOpenNetworkGuide,
  onOpenNavigation,
}) => {
  const [clock, setClock] = useState<{ iso: string; date: string; time: string } | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const date = now.toLocaleDateString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      const time = now.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setClock({ iso: now.toISOString(), date, time });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="relative z-30 border-b border-line bg-[#05101e]/90 backdrop-blur px-3 sm:px-5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {/* Left: navigation drawer button (small screens), logo and name */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenNavigation}
            className={`lg:hidden shrink-0 ${BTN_ICON} border-edge bg-raised text-slate-200 hover:bg-[#12294a]`}
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          <div
            className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-b from-[#1d84e8] to-[#0e3f8f] border border-[#3b9bff]/50 flex items-center justify-center text-white shadow-[0_0_20px_-6px_rgba(40,150,255,0.9)]"
            aria-hidden="true"
          >
            <Bot className="w-6 h-6" />
          </div>
          <h1 className="text-base sm:text-xl font-bold tracking-tight text-white truncate">RC Surveillance Robot</h1>
          {/* Mixed Content Warning Pill if user is accessing HTTP ESP32 from HTTPS dashboard */}
          {isMixedContent && (
            <button
              type="button"
              onClick={onOpenNetworkGuide}
              className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>HTTPS mixed-content warning</span>
            </button>
          )}
        </div>

        {/* Right: camera status, actions, date and time */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 max-sm:w-full">
          <ConnectionIndicator
            status={connectionStatus}
            isMixedContent={isMixedContent}
            detail={statusDetail}
            className="h-9 px-3 text-[13px] font-semibold"
          />

          {/* Never disabled: manual reconnect must stay available while automatic retries run. */}
          <button
            type="button"
            onClick={onReconnect}
            className={`${BTN_SECONDARY} px-2.5 sm:px-3.5 max-sm:ml-auto`}
            title="Reconnect the live stream and check camera reachability"
          >
            <RefreshCw
              className={`w-4 h-4 ${isReconnecting ? 'animate-spin text-cyan-400' : 'text-slate-200'}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Reconnect</span>
            <span className="sr-only sm:hidden">Reconnect</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className={`${BTN_ICON} border-edge bg-raised text-slate-200 hover:bg-[#12294a]`}
            title="Open Settings"
            aria-label="Settings"
          >
            <Settings className="w-[18px] h-[18px]" aria-hidden="true" />
          </button>

          <p className="hidden md:block text-right font-mono tabular-nums leading-tight pl-1">
            {clock ? (
              <time dateTime={clock.iso}>
                <span className="block text-[13px] text-slate-200">{clock.date}</span>
                <span className="block text-[15px] font-medium text-white">{clock.time}</span>
              </time>
            ) : (
              <span className="text-xs text-slate-400">Reading the clock</span>
            )}
          </p>
        </div>
      </div>
    </header>
  );
};
