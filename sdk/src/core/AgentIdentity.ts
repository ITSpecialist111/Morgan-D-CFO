/**
 * AgentIdentity — loads and validates the agent's job contract.
 *
 * Implements the CorpGen "persistent worker identity" primitive.
 * Generalised from Morgan's MORGAN_JOB_DESCRIPTION and MissionInstructionSet.
 */

import type { AgentContract } from '../types';

const OPERATING_WINDOW_RE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

export class AgentIdentity {
  private readonly contract: AgentContract;

  constructor(contract: AgentContract) {
    this.validate(contract);
    this.contract = contract;
  }

  get(): AgentContract {
    return { ...this.contract };
  }

  /**
   * Returns true if the current time (UTC) falls within the configured
   * operating window. Always returns true if no window is set.
   * Overnight windows (e.g. "22:00-06:00") are supported.
   */
  isOperatingNow(): boolean {
    const window = this.contract.operatingWindow;
    if (!window) return true;
    const match = OPERATING_WINDOW_RE.exec(window);
    if (!match) return true;
    const [, sh, sm, eh, em] = match.map(Number);
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    // Support overnight windows: start > end means the window crosses midnight.
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  private validate(contract: AgentContract): void {
    if (!contract.name?.trim()) throw new Error('AgentContract.name is required.');
    if (!contract.purpose?.trim()) throw new Error('AgentContract.purpose is required.');
    if (!contract.mandate?.length) throw new Error('AgentContract.mandate must have at least one item.');
    if (contract.operatingWindow) {
      const match = OPERATING_WINDOW_RE.exec(contract.operatingWindow);
      if (!match) {
        throw new Error(`AgentContract.operatingWindow must be in "HH:MM-HH:MM" format, got: ${contract.operatingWindow}`);
      }
      const [, sh, sm, eh, em] = match.map(Number);
      if (sh > 23 || sm > 59 || eh > 23 || em > 59) {
        throw new Error(`AgentContract.operatingWindow contains out-of-range time values: ${contract.operatingWindow}`);
      }
    }
  }
}
