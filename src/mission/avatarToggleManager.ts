/**
 * Avatar Toggle Manager
 * Handles switching between standard Morgan avatar and D-ID humanoid avatar
 * in Mission Control
 */

export interface AvatarPlatform {
  id: 'morgan' | 'did';
  name: string;
  description: string;
  type: 'standard' | 'humanoid';
  voiceEngine: string;
  configured: boolean;
  status: 'ready' | 'unconfigured' | 'error';
}

export class AvatarToggleManager {
  private currentPlatform: 'morgan' | 'did' = 'morgan';
  private availablePlatforms: Map<string, AvatarPlatform> = new Map();
  private listeners: Array<(platform: 'morgan' | 'did') => void> = [];

  constructor() {
    this.initializePlatforms();
  }

  /**
   * Initialize available avatar platforms
   */
  private initializePlatforms(): void {
    this.availablePlatforms.set('morgan', {
      id: 'morgan',
      name: 'Morgan (Standard)',
      description: 'Azure Speech Avatar with HD voice',
      type: 'standard',
      voiceEngine: 'Microsoft Speech Avatar (Ava 3)',
      configured: true, // Assume standard Morgan is always configured
      status: 'ready',
    });

    this.availablePlatforms.set('did', {
      id: 'did',
      name: 'Mia Elegant (D-ID)',
      description: 'D-ID humanoid avatar with 11Labs voices',
      type: 'humanoid',
      voiceEngine: 'ElevenLabs + D-ID Expressive Agent',
      configured: false,
      status: 'unconfigured',
    });
  }

  /**
   * Check if D-ID avatar is configured
   */
  async checkDidAvailability(): Promise<boolean> {
    try {
      const response = await fetch('/api/avatar/did/status');
      const data = (await response.json()) as { available: boolean };

      const didPlatform = this.availablePlatforms.get('did');
      if (didPlatform) {
        didPlatform.configured = data.available;
        didPlatform.status = data.available ? 'ready' : 'unconfigured';
      }

      return data.available;
    } catch (error) {
      console.error('Error checking D-ID availability:', error);
      const didPlatform = this.availablePlatforms.get('did');
      if (didPlatform) {
        didPlatform.status = 'error';
      }
      return false;
    }
  }

  /**
   * Get available platforms
   */
  getAvailablePlatforms(): AvatarPlatform[] {
    return Array.from(this.availablePlatforms.values());
  }

  /**
   * Switch to specified avatar platform
   */
  async switchTo(platformId: 'morgan' | 'did'): Promise<boolean> {
    if (platformId === this.currentPlatform) {
      return true;
    }

    if (platformId === 'did') {
      const available = await this.checkDidAvailability();
      if (!available) {
        console.error('D-ID avatar is not configured');
        return false;
      }
    }

    this.currentPlatform = platformId;
    this.notifyListeners(platformId);

    // Store preference in localStorage
    try {
      localStorage.setItem('avatarPlatformPreference', platformId);
    } catch (error) {
      console.warn('Could not save avatar preference:', error);
    }

    return true;
  }

  /**
   * Get current platform
   */
  getCurrentPlatform(): 'morgan' | 'did' {
    return this.currentPlatform;
  }

  /**
   * Get current platform details
   */
  getCurrentPlatformDetails(): AvatarPlatform {
    return this.availablePlatforms.get(this.currentPlatform) || this.availablePlatforms.get('morgan')!;
  }

  /**
   * Subscribe to platform changes
   */
  subscribe(callback: (platform: 'morgan' | 'did') => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /**
   * Notify all listeners of platform change
   */
  private notifyListeners(platform: 'morgan' | 'did'): void {
    this.listeners.forEach((listener) => listener(platform));
  }

  /**
   * Restore saved preference from localStorage
   */
  restoreSavedPreference(): void {
    try {
      const saved = localStorage.getItem('avatarPlatformPreference') as 'morgan' | 'did' | null;
      if (saved && (saved === 'morgan' || saved === 'did')) {
        this.currentPlatform = saved;
      }
    } catch (error) {
      console.warn('Could not restore avatar preference:', error);
    }
  }

  /**
   * Create UI element for avatar toggle
   */
  createToggleElement(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'avatar-toggle-panel';
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0;
    `;

    const label = document.createElement('span');
    label.textContent = 'Avatar:';
    label.style.cssText = `
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    `;

    const select = document.createElement('select');
    select.style.cssText = `
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      padding: 6px 8px;
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    `;

    // Add options
    const morganOption = document.createElement('option');
    morganOption.value = 'morgan';
    morganOption.textContent = 'Morgan (Standard)';
    select.appendChild(morganOption);

    const didOption = document.createElement('option');
    didOption.value = 'did';
    didOption.textContent = 'Mia Elegant (D-ID)';
    select.appendChild(didOption);

    // Set current value
    select.value = this.currentPlatform;

    // Handle change
    select.addEventListener('change', async (e) => {
      const target = e.target as HTMLSelectElement;
      const platform = target.value as 'morgan' | 'did';

      if (platform === 'did') {
        const available = await this.checkDidAvailability();
        if (!available) {
          alert('D-ID avatar is not configured. Please ensure DID_API_KEY, DID_AGENT_ID, and other required environment variables are set.');
          select.value = this.currentPlatform;
          return;
        }
      }

      await this.switchTo(platform);

      // Notify about switch (could trigger page refresh or avatar view update)
      window.dispatchEvent(
        new CustomEvent('avatarPlatformChanged', {
          detail: { platform },
        })
      );
    });

    container.appendChild(label);
    container.appendChild(select);

    return container;
  }
}

/**
 * Global avatar toggle manager instance
 */
let toggleManager: AvatarToggleManager | null = null;

export function getAvatarToggleManager(): AvatarToggleManager {
  if (!toggleManager) {
    toggleManager = new AvatarToggleManager();
    toggleManager.restoreSavedPreference();
  }
  return toggleManager;
}
