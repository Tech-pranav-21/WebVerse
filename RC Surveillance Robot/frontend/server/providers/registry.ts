/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeminiAdapter } from './geminiAdapter.js';
import { GroqAdapter } from './groqAdapter.js';
import { OpenAiAdapter } from './openaiAdapter.js';
import type { AiProviderAdapter, AiProviderId } from './types.js';

export class ProviderRegistry {
  private readonly adapters = new Map<AiProviderId, AiProviderAdapter>();

  constructor() {
    this.register(new GroqAdapter());
    this.register(new GeminiAdapter());
    this.register(new OpenAiAdapter());
  }

  register(adapter: AiProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AiProviderId): AiProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): AiProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(id: string): id is AiProviderId {
    return this.adapters.has(id as AiProviderId);
  }
}

export const providerRegistry = new ProviderRegistry();
