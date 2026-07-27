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
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  private validate(contract: AgentContract): void {
    if (!contract.name?.trim()) throw new Error('AgentContract.name is required.');
    if (!contract.purpose?.trim()) throw new Error('AgentContract.purpose is required.');
    if (!contract.mandate?.length) throw new Error('AgentContract.mandate must have at least one item.');
    if (contract.operatingWindow && !OPERATING_WINDOW_RE.test(contract.operatingWindow)) {
      throw new Error(`AgentContract.operatingWindow must be in "HH:MM-HH:MM" format, got: ${contract.operatingWindow}`);
    }
  }
}
