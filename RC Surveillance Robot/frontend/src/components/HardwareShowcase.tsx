/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  AlertCircle,
  BatteryCharging,
  Bot,
  Camera,
  CheckCircle2,
  Cpu,
  Eye,
  Maximize2,
  Radio,
  Sliders,
  Sparkles,
  Tv,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import { Notice, Panel, StatusBadge } from './ui';

export interface PrototypeImage {
  id: string;
  title: string;
  subtitle: string;
  src: string;
  alt: string;
  caption: string;
  badge: string;
}

export const PROTOTYPE_IMAGES: PrototypeImage[] = [
  {
    id: 'top-down',
    title: 'Benchtop Chassis & Wiring Assembly',
    subtitle: 'Overhead view of assembled prototype',
    src: '/docs/images/Hardware.jpeg',
    alt: 'Top-down photograph of the physical RC Surveillance Robot prototype chassis with Arduino Uno, ESP32-CAM, L298N driver, buck regulator, battery pack, LCD display, and drive wheels',
    caption:
      'Overhead photograph of the benchtop prototype showing the white chassis deck, Arduino Uno board, forward ESP32-CAM module, L298N motor driver, DC-DC step-down converter, battery assembly with protection board, illuminated 16x2 LCD display, Bluetooth module, and 4-wheel drive base.',
    badge: 'Primary Overhead View',
  },
  {
    id: 'front-angle',
    title: 'Front Optical Sensor & Display Elevation',
    subtitle: 'Front profile & camera mount angle',
    src: '/docs/images/Hardware%202.jpeg',
    alt: 'Front perspective photograph of the RC Surveillance Robot showing the vertically oriented ESP32-CAM sensor and elevated LCD screen',
    caption:
      'Front-facing perspective displaying the vertically positioned ESP32-CAM optical sensor module mounted at the leading edge of the chassis, alongside the elevated central 16x2 LCD screen and wheel assemblies.',
    badge: 'Optical Mount Perspective',
  },
  {
    id: 'components-overview',
    title: 'Subsystem & Module Inventory',
    subtitle: 'Modular hardware breakdown',
    src: '/docs/images/Hardware%20Component.jpeg',
    alt: 'Hardware component breakdown diagram showing Arduino Uno, ESP32-CAM, L298N motor driver, Bluetooth module, DC motor with wheel, battery pack, buck converter, and LCD display',
    caption:
      'Component breakdown infographic detailing the individual electronic modules, controllers, power regulation components, display, and propulsion hardware specified for the robotic platform.',
    badge: 'Component Breakdown',
  },
];

export interface HardwareComponentItem {
  name: string;
  role: string;
  category: string;
  verification: 'verified-prototype' | 'architecture-spec';
  verificationLabel: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const HARDWARE_COMPONENTS: HardwareComponentItem[] = [
  {
    name: 'Arduino Uno',
    role: 'Main Controller',
    category: 'Processing & Logic',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Microcontroller board orchestrating onboard peripheral signaling, logic coordination, and subsystem communications.',
    icon: Cpu,
  },
  {
    name: 'ESP32-CAM',
    role: 'Camera Module',
    category: 'Vision & Network',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Forward-mounted camera module with integrated Wi-Fi micro-controller for HTTP streaming and snapshot capture on local networks.',
    icon: Camera,
  },
  {
    name: 'HC-SR04',
    role: 'Ultrasonic Distance Sensor',
    category: 'Sensing & Telemetry',
    verification: 'architecture-spec',
    verificationLabel: 'Architecture specification (not mounted in photo)',
    description:
      'Proximity sensing module specified in system design architecture for distance measurement; not present on current chassis capture.',
    icon: Waves,
  },
  {
    name: 'Bluetooth Module',
    role: 'Wireless Communication',
    category: 'Communications',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Short-range serial transceiver module mounted on chassis for wireless command reception and telemetry data transmission.',
    icon: Radio,
  },
  {
    name: 'L298N',
    role: 'Motor Driver',
    category: 'Actuation & Power Drive',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Dual H-bridge driver module equipped with heatsink for driving DC motors and managing directional wheel propulsion.',
    icon: Zap,
  },
  {
    name: 'DC Motors & Wheels',
    role: 'Mobility & Propulsion',
    category: 'Mechanical / Locomotion',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Geared DC drive motors paired with high-traction treaded wheels mounted on the platform chassis for ground mobility.',
    icon: Bot,
  },
  {
    name: 'Battery Pack & Buck Converter',
    role: 'Power Supply & Regulation',
    category: 'Power Management',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Multi-cell battery pack featuring a protection board coupled to an adjustable step-down buck converter for regulated logic and motor supply rails.',
    icon: BatteryCharging,
  },
  {
    name: 'LCD Display',
    role: 'Information Display',
    category: 'User Interface',
    verification: 'verified-prototype',
    verificationLabel: 'Visually verified on prototype',
    description:
      'Alphanumeric 16x2 character display module mounted above the deck for visual operational feedback, status, and network readouts.',
    icon: Tv,
  },
];

export const HardwareShowcase: React.FC = () => {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const activeImage = PROTOTYPE_IMAGES[activeImageIndex];

  return (
    <div className="space-y-6">
      {/* Real Hardware Prototype Section */}
      <Panel
        id="real-hardware-prototype"
        title="Real Hardware Prototype"
        icon={Cpu}
        description="From software architecture to physical implementation."
        status={<StatusBadge tone="good" icon={CheckCircle2}>Real Prototype Photographs</StatusBadge>}
      >
        <div className="space-y-4">
          {/* Main Showcase Viewer */}
          <div className="overflow-hidden rounded-xl border border-edge bg-sunken">
            <div className="relative aspect-video sm:aspect-[16/10] md:aspect-[16/9] w-full bg-[#030914] flex items-center justify-center overflow-hidden group">
              <img
                src={activeImage.src}
                alt={activeImage.alt}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.01]"
              />

              {/* Overlay Top Bar */}
              <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent p-3 sm:p-4 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-black/70 px-2.5 py-1 font-mono text-[11px] text-cyan-300 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" aria-hidden="true" />
                  {activeImage.badge}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-black/60 px-2.5 py-1 text-slate-200 transition-colors hover:border-cyan-400/50 hover:bg-black/90 hover:text-white focus-visible:outline-cyan-400"
                  aria-label={`Enlarge ${activeImage.title}`}
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline text-xs">Full size</span>
                </button>
              </div>

              {/* Overlay Bottom Caption */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 sm:p-4">
                <p className="text-sm font-semibold text-white sm:text-base">{activeImage.title}</p>
                <p className="mt-0.5 text-xs text-slate-300 sm:text-[13px]">{activeImage.subtitle}</p>
              </div>
            </div>

            {/* Detailed Image Caption Bar */}
            <div className="border-t border-line bg-surface/90 p-3 sm:p-4 text-xs leading-relaxed text-slate-300">
              <p>
                <strong className="text-cyan-300">Caption: </strong>
                {activeImage.caption}
              </p>
            </div>
          </div>

          {/* Thumbnail Gallery Navigation */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
                Prototype Gallery ({PROTOTYPE_IMAGES.length} Views)
              </span>
              <span className="text-xs text-slate-400">Click to switch primary view</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="tablist" aria-label="Hardware prototype photograph views">
              {PROTOTYPE_IMAGES.map((img, index) => {
                const isSelected = index === activeImageIndex;
                return (
                  <button
                    key={img.id}
                    type="button"
                    role="tab"
                    id={`gallery-tab-${img.id}`}
                    aria-selected={isSelected}
                    aria-controls={`gallery-panel-${img.id}`}
                    onClick={() => setActiveImageIndex(index)}
                    className={`group relative flex items-center gap-3 overflow-hidden rounded-lg border p-2 text-left transition-all ${
                      isSelected
                        ? 'border-cyan-400 bg-raised/90 shadow-[0_0_15px_-3px_rgba(34,211,238,0.3)] ring-1 ring-cyan-400/50'
                        : 'border-line bg-surface/60 hover:border-edge hover:bg-raised/50'
                    }`}
                  >
                    <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded border border-line bg-black">
                      <img
                        src={img.src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                      {isSelected && (
                        <div className="absolute inset-0 bg-cyan-500/10 ring-1 ring-inset ring-cyan-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs font-semibold ${isSelected ? 'text-cyan-300' : 'text-slate-200 group-hover:text-white'}`}>
                        {img.title}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{img.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Panel>

      {/* Hardware Components Section */}
      <Panel
        id="hardware-components"
        title="Hardware Components"
        icon={Sliders}
        description="Physical modules, microcontrollers, and architectural components of the RC Surveillance Robot."
        status={<StatusBadge tone="accent">8 Components Cataloged</StatusBadge>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HARDWARE_COMPONENTS.map((item) => {
              const Icon = item.icon;
              const isVerified = item.verification === 'verified-prototype';
              return (
                <div
                  key={item.name}
                  className="flex flex-col justify-between rounded-xl border border-line bg-surface/80 p-3.5 transition-all hover:border-edge hover:bg-raised/70 hover:shadow-[0_4px_20px_-10px_rgba(8,60,120,0.6)]"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-sunken text-cyan-400">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <StatusBadge
                        tone={isVerified ? 'good' : 'neutral'}
                        className="text-[10px] py-0 px-1.5"
                      >
                        {isVerified ? 'Verified on Board' : 'Architecture BOM'}
                      </StatusBadge>
                    </div>

                    <div className="mt-3">
                      <h3 className="text-sm font-bold text-white">{item.name}</h3>
                      <p className="text-xs font-medium text-cyan-300/90">{item.role}</p>
                    </div>

                    <p className="mt-2 text-xs leading-relaxed text-slate-300">{item.description}</p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-line/60">
                    <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${isVerified ? 'bg-emerald-400' : 'bg-slate-500'}`}
                        aria-hidden="true"
                      />
                      {item.verificationLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Component Integrity & Honesty Notice */}
          <Notice tone="info">
            <p>
              <strong className="text-white">Component specification disclosure: </strong>
              Components shown above reflect visual inspection of the physical prototype and the design architecture. No unverified voltage ratings, battery capacities, motor operating specs, or wireless ranges are fabricated or claimed.
            </p>
          </Notice>
        </div>
      </Panel>

      {/* Prototype Status & Operational Honesty */}
      <Panel
        id="prototype-operational-status"
        title="Prototype Status & Demonstration Reality"
        icon={Eye}
        description="Engineering transparency regarding prototype implementation and website simulation scope."
        status={<StatusBadge tone="neutral">Implementation Disclosure</StatusBadge>}
      >
        <div className="grid gap-4 md:grid-cols-2 text-xs leading-relaxed text-slate-300">
          <div className="rounded-lg border border-line bg-sunken p-3.5 space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              Physical Hardware Reality
            </h4>
            <p>
              The photographs above depict the real physical benchtop hardware prototype assembled on an acrylic/foam chassis with an Arduino Uno, forward ESP32-CAM optical module, L298N driver, buck regulator, and power switch.
            </p>
          </div>

          <div className="rounded-lg border border-line bg-sunken p-3.5 space-y-1.5">
            <h4 className="font-semibold text-white flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              Web Demonstration Scope
            </h4>
            <p>
              This public showcase website operates in demonstration mode using simulated telemetry and mock frame layouts. The browser does not connect to the physical robot or transmit hardware actuation signals.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-line/70 bg-surface/50 p-3 text-xs text-slate-400">
          <p>
            <strong className="text-slate-200">Engineering boundaries: </strong>
            Hardware integration and live video streaming require local execution on the same network subnet as the ESP32-CAM. Obstacle detection, closed-loop telemetry, edge AI acceleration on microcontrollers, and unverified wireless driving are not claimed as active capabilities in this public build.
          </p>
        </div>
      </Panel>

      {/* Lightbox Modal */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activeImage.title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-xl border border-edge bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line bg-[#05101e] px-4 py-2.5">
              <div>
                <h3 className="text-sm font-bold text-white">{activeImage.title}</h3>
                <p className="text-xs text-cyan-300">{activeImage.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-raised hover:text-white focus-visible:outline-cyan-400"
                aria-label="Close high-resolution view"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto bg-black p-2 flex items-center justify-center">
              <img
                src={activeImage.src}
                alt={activeImage.alt}
                className="max-h-[70vh] w-auto max-w-full object-contain"
              />
            </div>
            <div className="border-t border-line bg-surface p-3 text-xs text-slate-300">
              {activeImage.caption}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
