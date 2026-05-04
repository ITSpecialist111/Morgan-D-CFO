// Voice gate — controls whether the voice web page is active.
// Toggled via Teams chat commands ("enable voice" / "disable voice").
// Default: disabled — voice must be explicitly enabled before each demo.

let _enabled = process.env.VOICE_ENABLED_DEFAULT === 'true';

export function isVoiceEnabled(): boolean {
  return _enabled;
}

export function enableVoice(): void {
  _enabled = true;
  console.log('[voice] Voice gate ENABLED');
}

export function disableVoice(): void {
  _enabled = false;
  console.log('[voice] Voice gate DISABLED');
}

export type VoiceCommand = 'enable' | 'disable' | 'status' | null;

export function detectVoiceCommand(text: string): VoiceCommand {
  const lower = text.toLowerCase().trim();
  if (/\b(enable|turn on|activate|start)\b.*\b(voice|avatar)\b/.test(lower)) return 'enable';
  if (/\b(voice|avatar)\b.*\b(enable|on|activate|start)\b/.test(lower)) return 'enable';
  if (lower === 'enable voice' || lower === 'voice on' || lower === 'enable avatar' || lower === 'avatar on') return 'enable';

  if (/\b(disable|turn off|deactivate|stop)\b.*\b(voice|avatar)\b/.test(lower)) return 'disable';
  if (/\b(voice|avatar)\b.*\b(disable|off|deactivate|stop)\b/.test(lower)) return 'disable';
  if (lower === 'disable voice' || lower === 'voice off' || lower === 'disable avatar' || lower === 'avatar off') return 'disable';

  if (/\b(voice|avatar)\b.*\bstatus\b/.test(lower)) return 'status';
  return null;
}
