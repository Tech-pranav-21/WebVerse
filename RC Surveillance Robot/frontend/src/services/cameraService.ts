/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CAMERA_STORAGE_KEY,
  DEFAULT_CAMERA_CONFIG,
  LAST_CONNECTION_KEY,
  RECOVERY_SCHEMA_VERSION,
  resolveCameraUrl,
} from '../config/cameraConfig';
import { CameraConfig } from '../types/camera';

class CameraService {
  private config: CameraConfig;

  constructor() {
    this.config = this.loadStoredConfig();
  }

  /**
   * Retrieves current camera configuration.
   */
  public getConfig(): CameraConfig {
    return { ...this.config };
  }

  /**
   * Saves updated camera configuration to localStorage.
   */
  public saveConfig(newConfig: Partial<CameraConfig>): CameraConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      recoverySchema: RECOVERY_SCHEMA_VERSION,
    };

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(
          CAMERA_STORAGE_KEY,
          JSON.stringify(this.config)
        );
      }
    } catch (e) {
      console.warn('Failed to persist camera config to localStorage:', e);
    }

    return this.getConfig();
  }

  /**
   * Resets configuration to the environment-derived defaults.
   */
  public resetToDefaults(): CameraConfig {
    this.config = { ...DEFAULT_CAMERA_CONFIG };
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(CAMERA_STORAGE_KEY);
      }
    } catch (e) {
      console.warn('Failed to clear localStorage camera config:', e);
    }
    return this.getConfig();
  }

  /**
   * Checks whether a live continuous stream path has been configured.
   */
  public isStreamConfigured(): boolean {
    return Boolean(this.config.baseUrl?.trim() && this.config.streamPath?.trim());
  }

  /**
   * Returns the fully resolved continuous stream URL, or empty string if unconfigured.
   */
  public getStreamUrl(configOverride?: CameraConfig): string {
    const active = configOverride || this.config;
    if (!active.streamPath?.trim()) {
      return '';
    }
    return resolveCameraUrl(active.baseUrl, active.streamPath);
  }

  /**
   * Returns the fully resolved snapshot URL.
   */
  public getSnapshotUrl(configOverride?: CameraConfig): string {
    const active = configOverride || this.config;
    const path = active.snapshotPath?.trim() || '/capture';
    return resolveCameraUrl(active.baseUrl, path);
  }

  /**
   * Records a verified successful connection timestamp.
   */
  public recordSuccessfulConnection(): number {
    const now = Date.now();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(LAST_CONNECTION_KEY, String(now));
      }
    } catch (e) {
      console.warn('Failed to store connection timestamp:', e);
    }
    return now;
  }

  /**
   * Retrieves the timestamp of the last verified connection, if any.
   */
  public getLastConnectionTime(): number | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(LAST_CONNECTION_KEY);
        if (val) {
          const parsed = Number(val);
          return isNaN(parsed) ? null : parsed;
        }
      }
    } catch {
      // Ignore
    }
    return null;
  }

  // --- Internal Storage Helpers ---

  private loadStoredConfig(): CameraConfig {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_CAMERA_CONFIG };
    }

    try {
      const stored = window.localStorage.getItem(CAMERA_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.recoverySchema !== RECOVERY_SCHEMA_VERSION) {
          // Saved by an older version: keep camera address and paths, but take the recovery
          // settings from the current defaults (the old values were never user-selectable).
          delete parsed.autoReconnect;
          delete parsed.reconnectIntervalSec;
          delete parsed.frameMonitor;
        }
        return {
          ...DEFAULT_CAMERA_CONFIG,
          ...parsed,
          recoverySchema: RECOVERY_SCHEMA_VERSION,
        };
      }
    } catch (e) {
      console.warn('Could not parse stored camera config, using defaults:', e);
    }

    return { ...DEFAULT_CAMERA_CONFIG };
  }
}

export const cameraService = new CameraService();
