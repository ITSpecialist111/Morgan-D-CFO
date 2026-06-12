/**
 * D-ID Avatar Service
 * Manages D-ID expressive agent initialization and voice enforcement
 * Based on specifications from avatar-voice-config-handoff.md
 *
 * Uses Node 20+ global fetch (no node-fetch dependency required).
 */

import { loadDidConfig, getDesiredDidVoiceConfig, DidPresenterConfig } from './didConfig';

export interface DidAgentResponse {
  id: string;
  created_at: string;
  features: {
    presenter_address: string;
    expression: string;
  };
  presenter?: DidPresenterConfig;
  voice?: DidPresenterConfig['voice'];
}

export interface DidSessionResponse {
  id: string;
  created_at: string;
  expires_at: string;
  auth: {
    type: string;
    credentials: string;
  };
  websocket_url: string;
}

/**
 * D-ID Avatar Service class
 * Handles agent management, voice enforcement, and session creation
 */
export class DidAvatarService {
  private readonly apiKey: string;
  private readonly agentId: string;
  private readonly baseUrl = 'https://api.d-id.com';

  constructor() {
    const config = loadDidConfig();
    if (!config) {
      throw new Error('D-ID configuration not available');
    }
    this.apiKey = config.apiKey;
    this.agentId = config.agentId;
  }

  /**
   * Get current agent configuration from D-ID
   */
  async getAgentVoiceConfig(): Promise<DidPresenterConfig | null> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/${this.agentId}`, {
        headers: {
          Authorization: `Basic ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to get agent config: ${response.status} ${response.statusText}`);
        return null;
      }

      const agent = (await response.json()) as DidAgentResponse;
      return agent.presenter || null;
    } catch (error) {
      console.error('Error getting agent voice config:', error);
      return null;
    }
  }

  /**
   * Enforce presenter voice configuration
   * Updates the agent voice to match the desired configuration
   */
  async ensureExpressiveAgentVoice(): Promise<boolean> {
    try {
      const config = loadDidConfig();
      if (!config) {
        console.error('D-ID config not loaded');
        return false;
      }

      const desiredVoice = getDesiredDidVoiceConfig(config);

      const payload = {
        presenter: {
          type: 'expressive',
          presenter_id: config.presenterId,
          voice: desiredVoice,
        },
      };

      const response = await fetch(`${this.baseUrl}/agents/${this.agentId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Basic ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to set agent voice: ${response.status} ${response.statusText}`);
        return false;
      }

      console.log('Agent voice enforced successfully');
      return true;
    } catch (error) {
      console.error('Error enforcing agent voice:', error);
      return false;
    }
  }

  /**
   * Create a new D-ID session for avatar interaction
   */
  async createSession(): Promise<DidSessionResponse | null> {
    try {
      const config = loadDidConfig();
      if (!config) {
        console.error('D-ID config not loaded');
        return null;
      }

      const payload = {
        agent_id: this.agentId,
        client_key: config.clientKey,
      };

      const response = await fetch(`${this.baseUrl}/agents/${this.agentId}/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`Failed to create session: ${response.status} ${response.statusText}`);
        return null;
      }

      const session = (await response.json()) as DidSessionResponse;
      return session;
    } catch (error) {
      console.error('Error creating session:', error);
      return null;
    }
  }

  /**
   * Close a D-ID session
   */
  async closeSession(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/agents/${this.agentId}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${this.apiKey}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Error closing session:', error);
      return false;
    }
  }

  /**
   * Verify agent presenter and voice configuration
   * Used for preflight checks before starting session
   */
  async verifyAgentConfiguration(): Promise<{
    isValid: boolean;
    presenter?: DidPresenterConfig;
    issues: string[];
  }> {
    try {
      const config = loadDidConfig();
      if (!config) {
        return {
          isValid: false,
          issues: ['D-ID configuration not loaded'],
        };
      }

      const agent = await this.getAgentVoiceConfig();
      if (!agent) {
        return {
          isValid: false,
          issues: ['Could not fetch agent configuration'],
        };
      }

      const issues: string[] = [];
      const desiredVoice = getDesiredDidVoiceConfig(config);

      if (agent.presenter_id !== config.presenterId) {
        issues.push(
          `Presenter mismatch: expected ${config.presenterId}, got ${agent.presenter_id}`
        );
      }

      if (agent.voice?.voice_id !== desiredVoice.voice_id) {
        issues.push(
          `Voice ID mismatch: expected ${desiredVoice.voice_id}, got ${agent.voice?.voice_id}`
        );
      }

      if (agent.voice?.model_id !== desiredVoice.model_id) {
        issues.push(
          `Model ID mismatch: expected ${desiredVoice.model_id}, got ${agent.voice?.model_id}`
        );
      }

      return {
        isValid: issues.length === 0,
        presenter: agent,
        issues,
      };
    } catch (error) {
      return {
        isValid: false,
        issues: [`Verification error: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}

/**
 * Get singleton instance of D-ID avatar service
 */
let serviceInstance: DidAvatarService | null = null;

export function getDidAvatarService(): DidAvatarService | null {
  try {
    if (!serviceInstance) {
      serviceInstance = new DidAvatarService();
    }
    return serviceInstance;
  } catch {
    return null;
  }
}
