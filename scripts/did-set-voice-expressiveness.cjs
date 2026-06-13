#!/usr/bin/env node
/**
 * Tune the D-ID agent's ElevenLabs voice for expressiveness.
 *
 * The avatar's "expression" (emotional range, warmth, emphasis) is driven by the
 * D-ID agent's presenter.voice config, NOT by the page connection code. By default
 * the agent uses eleven_flash_v2_5 with no voice_config, which sounds flat/neutral.
 * This script PATCHes presenter.voice with an expressive-but-executive profile and
 * verifies the result. It never prints secrets.
 *
 * Reads from .env (or process env):
 *   DID_API_KEY                (required)
 *   DID_AGENT_ID               (required)
 *   DID_VOICE_ID               (optional; defaults to the agent's current voice)
 *   ELEVENLABS_MODEL_ID        (optional; default eleven_turbo_v2_5)
 *   ELEVENLABS_STABILITY       (optional; default 0.4)
 *   ELEVENLABS_SIMILARITY_BOOST(optional; default 0.85)
 *   ELEVENLABS_STYLE           (optional; default 0.4)
 *   ELEVENLABS_USE_SPEAKER_BOOST (optional; default true)
 *   ELEVENLABS_RATE            (optional; "0.7".."1.2", omitted by default)
 *
 * CLI overrides (all optional):
 *   --model <id> --stability <0..1> --style <0..1> --similarity <0..1>
 *   --speaker-boost <true|false> --rate <0.7..1.2>
 *   --revert         restore the flat default (eleven_flash_v2_5, no voice_config)
 *   --dry-run        print the payload (no secrets) without applying
 *
 * Usage:
 *   node scripts/did-set-voice-expressiveness.cjs
 *   node scripts/did-set-voice-expressiveness.cjs --style 0.6 --stability 0.3
 *   node scripts/did-set-voice-expressiveness.cjs --revert
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function didFetch(url, apiKey, options = {}) {
  const headers = Object.assign(
    { Authorization: `Basic ${apiKey}`, accept: 'application/json' },
    options.headers || {}
  );
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  loadDotEnv();

  const apiKey = process.env.DID_API_KEY;
  const agentId = process.env.DID_AGENT_ID;
  if (!apiKey || !agentId) {
    console.error('Missing DID_API_KEY or DID_AGENT_ID (set them in .env).');
    process.exit(1);
  }

  const base = 'https://api.d-id.com';
  const agentUrl = `${base}/agents/${encodeURIComponent(agentId)}`;

  // Read the current presenter so we keep voice_id and don't disturb other fields.
  const current = await didFetch(agentUrl, apiKey);
  if (!current.ok) {
    console.error(`Failed to read agent (${current.status}).`);
    process.exit(1);
  }
  const currentVoice = (current.body && current.body.presenter && current.body.presenter.voice) || {};

  const revert = hasFlag('revert');
  const voiceId = getArg('voice') || process.env.DID_VOICE_ID || currentVoice.voice_id;
  if (!voiceId) {
    console.error('No voice_id available (set DID_VOICE_ID or --voice).');
    process.exit(1);
  }

  let voice;
  if (revert) {
    voice = { type: 'elevenlabs', voice_id: voiceId, model_id: 'eleven_flash_v2_5' };
  } else {
    const model = getArg('model') || process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5';
    const stability = parseFloat(getArg('stability') || process.env.ELEVENLABS_STABILITY || '0.4');
    const similarity = parseFloat(getArg('similarity') || process.env.ELEVENLABS_SIMILARITY_BOOST || '0.85');
    const style = String(getArg('style') || process.env.ELEVENLABS_STYLE || '0.4');
    const speakerBoostRaw = getArg('speaker-boost') || process.env.ELEVENLABS_USE_SPEAKER_BOOST || 'true';
    const speakerBoost = String(speakerBoostRaw).toLowerCase() !== 'false';
    const rate = getArg('rate') || process.env.ELEVENLABS_RATE || '';

    const voice_config = {
      stability,
      similarity_boost: similarity,
      style,
      use_speaker_boost: speakerBoost,
    };
    if (rate) voice_config.rate = String(rate);

    voice = { type: 'elevenlabs', voice_id: voiceId, model_id: model, voice_config };
  }

  const payload = { presenter: { voice } };

  // Print the payload (no secrets) for transparency.
  console.log(revert ? 'Reverting voice to flat default:' : 'Applying expressive voice profile:');
  console.log(JSON.stringify(voice, null, 2));

  if (hasFlag('dry-run')) {
    console.log('Dry run — not applied.');
    return;
  }

  const patch = await didFetch(agentUrl, apiKey, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!patch.ok) {
    console.error(`PATCH failed (${patch.status}).`);
    const kind = patch.body && (patch.body.kind || patch.body.description);
    if (kind) console.error(`  ${kind}`);
    process.exit(1);
  }

  // Verify.
  const after = await didFetch(agentUrl, apiKey);
  const v = (after.body && after.body.presenter && after.body.presenter.voice) || {};
  console.log('\nUpdated agent voice:');
  console.log(JSON.stringify(v, null, 2));
  console.log('\nDone. Reconnect the avatar (reload /voice/did) to hear the new delivery.');
}

main().catch((err) => {
  console.error('Unexpected error:', err && err.message ? err.message : err);
  process.exit(1);
});
