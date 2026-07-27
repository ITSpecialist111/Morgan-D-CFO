/**
 * LearningPlaybook — experiential learning pattern store.
 *
 * Records validated workflow patterns from prior cycles so the agent can
 * reuse them when the same trigger conditions appear.
 *
 * Generalised from Morgan's getExperientialLearningPlaybook.
 */

import crypto from 'crypto';
import type { LearningPattern } from '../types';
import type { StorageProvider } from '../adapters/StorageProvider';

const NAMESPACE = 'learning-playbook';

export interface LearningPlaybookOptions {
  storage: StorageProvider;
}

export class LearningPlaybook {
  private readonly storage: StorageProvider;

  constructor(options: LearningPlaybookOptions) {
    this.storage = options.storage;
  }

  async add(pattern: Omit<LearningPattern, 'id'>): Promise<LearningPattern> {
    // NB6 fix: use crypto.randomUUID() to avoid ID collisions under concurrent adds
    const id = `pattern-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const full: LearningPattern = { id, ...pattern };
    await this.storage.set(NAMESPACE, id, full);
    return full;
  }

  async list(status?: LearningPattern['status']): Promise<LearningPattern[]> {
    const keys = await this.storage.listKeys(NAMESPACE);
    const patterns: LearningPattern[] = [];
    for (const key of keys) {
      const pattern = await this.storage.get<LearningPattern>(NAMESPACE, key);
      if (pattern && (!status || pattern.status === status)) patterns.push(pattern);
    }
    return patterns;
  }

  async promote(id: string): Promise<boolean> {
    const pattern = await this.storage.get<LearningPattern>(NAMESPACE, id);
    if (!pattern) return false;
    await this.storage.set(NAMESPACE, id, { ...pattern, status: 'active' });
    return true;
  }

  async remove(id: string): Promise<void> {
    await this.storage.remove(NAMESPACE, id);
  }
}
