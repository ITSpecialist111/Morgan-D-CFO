import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const emulatorModule = require('../badge-emulator/emulator-core.js') as {
  BadgeEmulator: new () => any;
  STATES: Record<string, string>;
  PIN_MAP: Record<string, { pad: string; gpio: number; direction: string }>;
};

const { BadgeEmulator, STATES, PIN_MAP } = emulatorModule;

test('badge component emulator', async (suite) => {
  await suite.test('matches the Rev A XIAO pin contract', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(PIN_MAP).map(([name, pin]) => [name, [pin.pad, pin.gpio, pin.direction]])),
      {
        ptt: ['D0', 1, 'input'],
        displayCs: ['D1', 0, 'output'],
        displayDc: ['D2', 25, 'output'],
        amplifierSd: ['D3', 7, 'output'],
        microphoneData: ['D4', 23, 'input'],
        i2sWordSelect: ['D5', 24, 'output'],
        i2sBitClock: ['D6', 11, 'output'],
        amplifierData: ['D7', 12, 'output'],
        displayClock: ['D8', 8, 'output'],
        statusLed: ['D9', 9, 'reserved'],
        displayMosi: ['D10', 10, 'output'],
      },
    );
  });

  await suite.test('boots and passes every component baseline check', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    assert.equal(emulator.state, STATES.STANDBY);
    const result = emulator.runValidation();
    assert.equal(result.pass, true);
    assert.equal(result.passed, 12);
    assert.equal(result.total, 12);
  });

  await suite.test('runs the local PTT fallback with firmware timings', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    emulator.setFault('wifiDown', true);
    emulator.pressPtt();
    emulator.advance(34);
    assert.equal(emulator.state, STATES.STANDBY);
    emulator.advance(1);
    assert.equal(emulator.state, STATES.LISTENING);
    assert.equal(emulator.voiceConnected, false);
    emulator.releasePtt();
    emulator.advance(35);
    assert.equal(emulator.state, STATES.THINKING);
    emulator.advance(900);
    assert.equal(emulator.state, STATES.SPEAKING);
    emulator.advance(1100);
    assert.equal(emulator.state, STATES.STANDBY);
  });

  await suite.test('runs the cloud PTT path and generates 24 kHz PCM', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    emulator.pressPtt();
    emulator.advance(35);
    assert.equal(emulator.state, STATES.LISTENING);
    assert.equal(emulator.voiceConnected, true);
    const mic = emulator.generateMicrophoneSamples(240);
    assert.equal(mic.samples.length, 240);
    assert.ok(mic.rms > 0.1);
    assert.equal(mic.clipped, false);
    emulator.releasePtt();
    emulator.advance(35);
    assert.equal(emulator.state, STATES.THINKING);
    emulator.advance(650);
    assert.equal(emulator.state, STATES.SPEAKING);
    assert.equal(emulator.speaker.audible, true);
    emulator.advance(1100);
    assert.equal(emulator.state, STATES.STANDBY);
  });

  await suite.test('accepts externally timed Voice Live responses', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    emulator.pressPtt();
    emulator.advance(35);
    assert.equal(emulator.state, STATES.LISTENING);
    emulator.submitExternalVoiceInput();
    emulator.advance(35);
    assert.equal(emulator.state, STATES.THINKING);
    emulator.beginExternalResponse();
    assert.equal(emulator.state, STATES.SPEAKING);
    emulator.completeExternalResponse();
    assert.equal(emulator.state, STATES.STANDBY);
    emulator.disconnectExternalVoice();
    assert.equal(emulator.voiceConnected, false);
  });

  await suite.test('models charging, discharge, and brownout detection', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    const initialSoc = emulator.power.batterySoc;
    emulator.advance(60000);
    assert.ok(emulator.power.batterySoc >= initialSoc);
    emulator.setUsbConnected(false);
    const unpluggedSoc = emulator.power.batterySoc;
    emulator.advance(60000);
    assert.ok(emulator.power.batterySoc < unpluggedSoc);
    emulator.setFault('batteryBrownout', true);
    assert.equal(emulator.checkById('power').pass, false);
  });

  await suite.test('exercises optional NFC, IMU, and haptic behaviors', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    assert.equal(emulator.tapNfc(true), true);
    assert.equal(emulator.overlay, 'ACCESS');
    emulator.advance(1800);
    assert.equal(emulator.overlay, null);
    assert.equal(emulator.tapNfc(false), false);
    assert.equal(emulator.overlay, 'ALERT');
    assert.equal(emulator.setTilt(40, 0), true);
    assert.equal(emulator.optionals.haptic.lastEffect, 'click');
  });

  await suite.test('detects every injected fault in the matrix', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    const result = emulator.runFaultMatrix();
    assert.equal(result.pass, true);
    assert.equal(result.detected, 24);
    assert.equal(result.total, 24);
  });

  await suite.test('emits telemetry compatible with the badge API schema', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    const telemetry = emulator.telemetry();
    assert.deepEqual(Object.keys(telemetry).sort(), [
      'batteryPresence',
      'batteryVolts',
      'deviceId',
      'firmwareVersion',
      'freeHeapBytes',
      'peripherals',
      'psramBytes',
      'rssiDbm',
      'state',
    ]);
    assert.equal(telemetry.state, STATES.STANDBY);
    assert.equal(telemetry.psramBytes, 8388608);
    assert.deepEqual(telemetry.peripherals, {
      display: 'ready',
      microphone: 'ready',
      amplifier: 'ready',
    });
  });

  await suite.test('ships microphone, transcript, and speaker controls', () => {
    const htmlPath = path.join(__dirname, '..', 'badge-emulator', 'index.html');
    const scriptPath = path.join(__dirname, '..', 'badge-emulator', 'emulator-ui.js');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const script = fs.readFileSync(scriptPath, 'utf8');
    for (const id of [
      'voice-connect',
      'voice-disconnect',
      'voice-status',
      'voice-transcript',
      'voice-text-form',
      'voice-text-input',
      'ptt-button',
    ]) {
      assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(script, /\/api\/badge-emulator\/voice/);
    assert.match(script, /getUserMedia/);
    assert.match(script, /response\.audio\.delta/);
  });
});
