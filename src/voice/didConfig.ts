/**
 * D-ID Avatar Configuration
 * Manages environment variables and configuration for D-ID humanoid avatar platform
 * Follows the exact specifications from avatar-voice-config-handoff.md
 */

export interface DidEnvironmentConfig {
  // Core provider mode
  provider: 'did';
  useClips: boolean;
  speechSource: 'did';

  // D-ID credentials and identity pins
  apiKey: string;
  agentId: string;
  clientKey: string;

  // Presenter configuration
  presenterName: string;
  presenterId: string;

  // Voice configuration
  voiceType: 'elevenlabs';
  voiceId: string;

  // ElevenLabs configuration
  elevenLabsApiKey: string;
  elevenLabsModelId: string;
  elevenLabsStability?: number;
  elevenLabsSimilarityBoost?: number;
  elevenLabsStyle?: string;
  elevenLabsUseSpeakerBoost?: boolean;
  elevenLabsRate?: string;

  // UI Background
  backgroundUrl: string;
}

export interface DidPresenterConfig {
  type: 'expressive';
  presenter_id: string;
  voice: {
    type: 'elevenlabs';
    voice_id: string;
    model_id: string;
    voice_config?: {
      stability?: number;
      similarity_boost?: number;
      style?: string;
      use_speaker_boost?: boolean;
      rate?: string;
    };
  };
}

export interface DidClientConfig {
  provider: 'did';
  mode: 'agent';
  did: {
    configured: boolean;
    agentId: string;
  };
}

/**
 * Load D-ID configuration from environment variables
 * Returns null if D-ID is not configured
 */
export function loadDidConfig(): DidEnvironmentConfig | null {
  const apiKey = process.env.DID_API_KEY;
  const agentId = process.env.DID_AGENT_ID;
  const clientKey = process.env.DID_CLIENT_KEY;

  // If any required config is missing, D-ID is not configured
  if (!apiKey || !agentId || !clientKey) {
    return null;
  }

  return {
    provider: 'did',
    useClips: process.env.DID_USE_CLIPS === 'true',
    speechSource: (process.env.DID_SPEECH_SOURCE as 'did') || 'did',

    apiKey,
    agentId,
    clientKey,

    presenterName: process.env.DID_PRESENTER_NAME || 'Mia Elegant',
    presenterId: process.env.DID_PRESENTER_ID || 'public_mia_elegant@avt_TJ0Tq5',

    voiceType: (process.env.DID_VOICE_TYPE as 'elevenlabs') || 'elevenlabs',
    voiceId: process.env.DID_VOICE_ID || 'yV421IFuyZtM5nbmHxOl',

    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
    elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5',
    elevenLabsStability: process.env.ELEVENLABS_STABILITY ? parseFloat(process.env.ELEVENLABS_STABILITY) : undefined,
    elevenLabsSimilarityBoost: process.env.ELEVENLABS_SIMILARITY_BOOST ? parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST) : undefined,
    elevenLabsStyle: process.env.ELEVENLABS_STYLE,
    elevenLabsUseSpeakerBoost: process.env.ELEVENLABS_USE_SPEAKER_BOOST ? process.env.ELEVENLABS_USE_SPEAKER_BOOST.toLowerCase() !== 'false' : undefined,
    elevenLabsRate: process.env.ELEVENLABS_RATE,

    backgroundUrl: process.env.AVATAR_BACKGROUND_URL || 'https://raw.githubusercontent.com/ITSpecialist111/Aria-Avatar-Foundry-WorkIQ/main/background.jpg',
  };
}

/**
 * Get the desired voice configuration for D-ID presenter
 * This is the target state that the agent should have.
 *
 * Includes an expressive-but-executive voice_config so Morgan delivers with
 * emotional range and emphasis instead of the flat ElevenLabs default. Every
 * value is env-tunable (ELEVENLABS_STABILITY / _STYLE / _SIMILARITY_BOOST /
 * _USE_SPEAKER_BOOST / _RATE); the defaults below are applied when unset.
 */
export function getDesiredDidVoiceConfig(config: DidEnvironmentConfig): DidPresenterConfig['voice'] {
  const voice: DidPresenterConfig['voice'] = {
    type: config.voiceType,
    voice_id: config.voiceId,
    model_id: config.elevenLabsModelId,
    voice_config: {
      stability: config.elevenLabsStability ?? 0.4,
      similarity_boost: config.elevenLabsSimilarityBoost ?? 0.85,
      style: config.elevenLabsStyle ?? '0.4',
      use_speaker_boost: config.elevenLabsUseSpeakerBoost ?? true,
    },
  };
  if (config.elevenLabsRate && voice.voice_config) {
    voice.voice_config.rate = config.elevenLabsRate;
  }
  return voice;
}

/**
 * Build the client-facing D-ID configuration
 */
export function buildDidClientConfig(config: DidEnvironmentConfig): DidClientConfig {
  return {
    provider: 'did',
    mode: 'agent',
    did: {
      configured: true,
      agentId: config.agentId,
    },
  };
}

/**
 * Validate D-ID configuration
 * Returns { valid: true } or { valid: false, errors: [] }
 */
export function validateDidConfig(config: DidEnvironmentConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.apiKey) errors.push('DID_API_KEY is required');
  if (!config.agentId) errors.push('DID_AGENT_ID is required');
  if (!config.clientKey) errors.push('DID_CLIENT_KEY is required');
  if (!config.elevenLabsApiKey) errors.push('ELEVENLABS_API_KEY is required');
  if (!config.voiceId) errors.push('DID_VOICE_ID is required');
  if (!config.presenterId) errors.push('DID_PRESENTER_ID is required');

  // Validate presenter ID format
  if (config.presenterId && !config.presenterId.includes('@')) {
    errors.push('DID_PRESENTER_ID must be in format: presenter_id@avatar_id');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get current D-ID configuration status
 */
export function getDidConfigStatus(): {
  isConfigured: boolean;
  missingKeys: string[];
  config: DidEnvironmentConfig | null;
} {
  const config = loadDidConfig();

  if (!config) {
    return {
      isConfigured: false,
      missingKeys: [
        !process.env.DID_API_KEY ? 'DID_API_KEY' : null,
        !process.env.DID_AGENT_ID ? 'DID_AGENT_ID' : null,
        !process.env.DID_CLIENT_KEY ? 'DID_CLIENT_KEY' : null,
      ].filter(Boolean) as string[],
      config: null,
    };
  }

  const validation = validateDidConfig(config);

  return {
    isConfigured: validation.valid,
    missingKeys: validation.errors,
    config: validation.valid ? config : null,
  };
}
