/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Loader2, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared building blocks of the dashboard, so every page looks and behaves alike: one card style,
 * one status badge, one set of button and field classes, a switch, tabs and the large action
 * buttons of the Dashboard. Presentation only; none of this holds camera, motion, snapshot or AI logic.
 */

// ---------------------------------------------------------------------------
// Buttons and fields (class strings, so they work on <button>, <a> and <label>)
// ---------------------------------------------------------------------------

const BTN =
  'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

/** The one main action of a panel: the blue gradient of the reference design. */
export const BTN_PRIMARY = `${BTN} text-white bg-gradient-to-b from-[#1d84e8] to-[#1355c2] border border-[#3b9bff]/50 shadow-[0_0_18px_-6px_rgba(40,150,255,0.8)] hover:from-[#2a92f5] hover:to-[#1a62d4]`;
export const BTN_SECONDARY = `${BTN} bg-raised text-slate-100 border border-edge hover:bg-[#12294a] hover:border-[#2a6aa8]`;
export const BTN_GHOST = `${BTN} text-slate-300 hover:bg-raised hover:text-white`;
/** A destructive action before it is confirmed. */
export const BTN_DANGER = `${BTN} bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20`;
/** The confirmation step of a destructive action. */
export const BTN_DANGER_SOLID = `${BTN} bg-rose-500 text-white hover:bg-rose-400`;
/** Square icon-only button; always give it an aria-label. */
export const BTN_ICON =
  'inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export const FIELD =
  'h-9 px-2.5 text-[13px] text-slate-100 bg-sunken border border-edge rounded-lg placeholder:text-slate-500 disabled:opacity-50';

/** Native checkbox / radio, sized for touch and tinted with the accent. */
export const CHECK = 'accent-cyan-400 w-4 h-4 shrink-0';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

export type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-raised/80 text-slate-300 border-edge',
  good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  bad: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  accent: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
};

const DOT_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-slate-500',
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
  accent: 'bg-cyan-400',
};

interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Show the colour dot (default). The text always says the same thing, so colour is never the only signal. */
  dot?: boolean;
  /** Show a spinner instead of the dot while something is in progress. */
  busy?: boolean;
  /** An icon shown instead of the dot. */
  icon?: LucideIcon;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  tone = 'neutral',
  dot = true,
  busy = false,
  icon: Icon,
  className = '',
  children,
  ...rest
}) => (
  <span
    {...rest}
    className={`inline-flex items-center gap-1.5 min-h-6 px-2 py-0.5 rounded-md border text-xs font-medium ${BADGE_TONE[tone]} ${className}`}
  >
    {busy ? (
      <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
    ) : Icon ? (
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
    ) : dot ? (
      <span className={`w-1.5 h-1.5 rounded-full ${DOT_TONE[tone]}`} aria-hidden="true" />
    ) : null}
    <span>{children}</span>
  </span>
);

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

interface PanelProps {
  /** Unique within the page; links the heading to the section for screen readers. */
  id: string;
  title: string;
  icon?: LucideIcon;
  description?: React.ReactNode;
  /** Status badge(s) shown top right. */
  status?: React.ReactNode;
  /** Buttons shown top right, after the status. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const Panel: React.FC<PanelProps> = ({
  id,
  title,
  icon: Icon,
  description,
  status,
  actions,
  children,
  className = '',
}) => (
  <section
    aria-labelledby={`${id}-title`}
    className={`@container bg-surface border border-line rounded-xl p-4 sm:p-5 shadow-[0_8px_30px_-18px_rgba(8,60,120,0.8)] ${className}`}
  >
    <header className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 min-h-9">
        <h2 id={`${id}-title`} className="flex items-center gap-2.5 text-base font-semibold text-white">
          {Icon && <Icon className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden="true" />}
          <span>{title}</span>
        </h2>
        {(status || actions) && <div className="flex flex-wrap items-center gap-2">{status}{actions}</div>}
      </div>
      {description && <p className="text-[13px] leading-relaxed text-slate-400 max-w-prose">{description}</p>}
    </header>
    {children != null && <div className="mt-4 space-y-4">{children}</div>}
  </section>
);

// ---------------------------------------------------------------------------
// Notice (a message that belongs to one panel)
// ---------------------------------------------------------------------------

export type NoticeTone = 'info' | 'good' | 'warn' | 'bad';

const NOTICE: Record<NoticeTone, { box: string; icon: LucideIcon; iconCls: string }> = {
  info: { box: 'bg-sunken border-edge text-slate-300', icon: Info, iconCls: 'text-cyan-400' },
  good: { box: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-100', icon: CheckCircle2, iconCls: 'text-emerald-400' },
  warn: { box: 'bg-amber-500/10 border-amber-500/30 text-amber-100', icon: AlertTriangle, iconCls: 'text-amber-300' },
  bad: { box: 'bg-rose-500/10 border-rose-500/30 text-rose-100', icon: XCircle, iconCls: 'text-rose-300' },
};

interface NoticeProps {
  tone?: NoticeTone;
  role?: 'status' | 'alert';
  className?: string;
  children: React.ReactNode;
}

export const Notice: React.FC<NoticeProps> = ({ tone = 'info', role, className = '', children }) => {
  const { box, icon: Icon, iconCls } = NOTICE[tone];
  return (
    <div role={role} className={`flex items-start gap-2.5 p-3 rounded-lg border text-[13px] leading-relaxed ${box} ${className}`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconCls}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2 break-words">{children}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Disclosure (progressive disclosure for explanations and advanced settings)
// ---------------------------------------------------------------------------

interface DisclosureProps {
  summary: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Disclosure: React.FC<DisclosureProps> = ({ summary, defaultOpen = false, className = '', children }) => (
  <details open={defaultOpen} className={`group ${className}`}>
    <summary className="flex items-center gap-1.5 cursor-pointer select-none list-none text-[13px] font-medium text-slate-300 hover:text-white [&::-webkit-details-marker]:hidden">
      <ChevronRight className="w-4 h-4 text-cyan-400 transition-transform group-open:rotate-90" aria-hidden="true" />
      <span>{summary}</span>
    </summary>
    <div className="mt-3 pl-[22px] space-y-3">{children}</div>
  </details>
);

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What the switch controls, for screen readers. */
  label: string;
  disabled?: boolean;
}

/** An on/off switch (role="switch"). The words ON and OFF are on it, so state never depends on colour alone. */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, label, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex items-center shrink-0 w-[62px] h-8 rounded-full border text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      checked
        ? 'bg-emerald-500 border-emerald-300/60 text-white justify-start pl-3 shadow-[0_0_14px_-4px_rgba(52,211,153,0.8)]'
        : 'bg-raised border-edge text-slate-300 justify-end pr-3'
    }`}
  >
    <span>{checked ? 'ON' : 'OFF'}</span>
    <span
      aria-hidden="true"
      className={`absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white shadow transition-all ${
        checked ? 'right-1' : 'left-1'
      }`}
    />
  </button>
);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

interface TabItem<T extends string> {
  id: T;
  label: string;
  /** A small count shown after the label. */
  count?: number;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the tab list for screen readers. */
  label: string;
  /** Prefix for the ids that connect each tab to its panel (`${idBase}-tab-x`, `${idBase}-panel`). */
  idBase: string;
}

/** Tab buttons with arrow-key support. The caller renders the panel with role="tabpanel" and aria-labelledby `${idBase}-tab-<id>`. */
export function Tabs<T extends string>({ items, value, onChange, label, idBase }: TabsProps<T>) {
  const move = (from: number, step: number) => {
    const next = items[(from + step + items.length) % items.length];
    onChange(next.id);
    document.getElementById(`${idBase}-tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item, i) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            id={`${idBase}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idBase}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={`inline-flex items-center gap-2 h-9 px-4 rounded-lg border text-[13px] font-semibold transition-colors ${
              active
                ? 'bg-gradient-to-b from-[#1d84e8] to-[#1355c2] border-[#3b9bff]/50 text-white shadow-[0_0_16px_-6px_rgba(40,150,255,0.8)]'
                : 'bg-raised/60 border-line text-slate-300 hover:text-white hover:border-edge'
            }`}
          >
            <span>{item.label}</span>
            {item.count != null && (
              <span className={`text-xs font-mono tabular-nums ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard action buttons and stat cards
// ---------------------------------------------------------------------------

type ActionTone = 'primary' | 'outline' | 'plain';

const ACTION_TONE: Record<ActionTone, { box: string; icon: string }> = {
  primary: {
    box: 'text-white bg-gradient-to-b from-[#1d84e8] to-[#1355c2] border-[#3b9bff]/50 shadow-[0_0_22px_-8px_rgba(40,150,255,0.9)] hover:from-[#2a92f5] hover:to-[#1a62d4]',
    icon: 'bg-white/15 text-white',
  },
  outline: {
    box: 'text-cyan-200 bg-sunken border-cyan-400/50 hover:bg-[#0a2036] hover:border-cyan-300',
    icon: 'bg-cyan-400/10 text-cyan-300',
  },
  plain: {
    box: 'text-slate-100 bg-surface border-edge hover:bg-raised hover:border-[#2a6aa8]',
    icon: 'bg-raised text-slate-200',
  },
};

interface ActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  tone?: ActionTone;
  /** Spin the icon (work in progress). */
  busy?: boolean;
}

/** A large button with its icon in a tile, as in the reference Dashboard. */
export const ActionButton: React.FC<ActionButtonProps> = ({
  icon: Icon,
  tone = 'plain',
  busy = false,
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button
    {...rest}
    type={type}
    className={`flex items-center gap-3 w-full min-h-14 px-3 rounded-xl border text-[15px] font-semibold text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ACTION_TONE[tone].box} ${className}`}
  >
    <span className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${ACTION_TONE[tone].icon}`}>
      <Icon className={`w-5 h-5 ${busy ? 'animate-pulse' : ''}`} aria-hidden="true" />
    </span>
    <span className="min-w-0">{children}</span>
  </button>
);

export type StatTone = 'good' | 'warn' | 'bad' | 'neutral' | 'violet' | 'blue' | 'amber';

const STAT_TILE: Record<StatTone, string> = {
  good: 'bg-emerald-500/15 text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-300',
  bad: 'bg-rose-500/15 text-rose-300',
  neutral: 'bg-raised text-slate-300',
  violet: 'bg-violet-500/15 text-violet-300',
  blue: 'bg-sky-500/15 text-sky-300',
  amber: 'bg-amber-400/15 text-amber-300',
};

interface StatCardProps {
  icon: LucideIcon;
  tone: StatTone;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({ icon: Icon, tone, label, value, detail }) => (
  <div className="flex items-center gap-4 bg-surface border border-line rounded-xl p-4 shadow-[0_8px_30px_-18px_rgba(8,60,120,0.8)]">
    <span className={`w-14 h-14 shrink-0 rounded-xl flex items-center justify-center ${STAT_TILE[tone]}`}>
      <Icon className="w-7 h-7" aria-hidden="true" />
    </span>
    <div className="min-w-0">
      <div className="text-[13px] text-slate-400">{label}</div>
      <div className="text-lg font-semibold text-white leading-tight break-words">{value}</div>
      {detail && <div className="text-xs text-slate-400 mt-0.5 break-words">{detail}</div>}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

export const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="font-mono text-[12px] text-cyan-300">{children}</code>
);

/** Muted secondary line. Never lighter than slate-400: that is the contrast floor on the dark surfaces. */
export const Hint: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <p className={`text-xs leading-relaxed text-slate-400 ${className}`}>{children}</p>
);

/** A recessed, scrollable list area for logs and event lists. */
export const ListWell: React.FC<{ label: string; maxHeight?: string; children: React.ReactNode }> = ({
  label,
  maxHeight = 'max-h-72',
  children,
}) => (
  <ul aria-label={label} className={`${maxHeight} overflow-y-auto rounded-lg bg-sunken border border-line divide-y divide-line`}>
    {children}
  </ul>
);
