import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const emulatorModule = require('../badge-emulator/emulator-core.js') as {
  BadgeEmulator: new () => any;
  STATES: Record<string, string>;
  PIN_MAP: Record<string, { pad: string; gpio: number; direction: string; net: string }>;
};

const { BadgeEmulator, STATES, PIN_MAP } = emulatorModule;

// Pad aliases from the Arduino XIAO_ESP32C5 variant (variants/XIAO_ESP32C5/pins_arduino.h).
const XIAO_PAD_TO_GPIO: Record<string, number> = {
  D0: 1, D1: 0, D2: 25, D3: 7, D4: 23, D5: 24,
  D6: 11, D7: 12, D8: 8, D9: 9, D10: 10,
};

// Maps the firmware constant to the emulator pin-map key it must agree with.
const FIRMWARE_PIN_BINDINGS: Record<string, string> = {
  kPttPin: 'ptt',
  kAmplifierSdPin: 'amplifierSd',
  kDisplayDcPin: 'displayDc',
  kDisplayCsPin: 'displayCs',
  kMicrophoneDataPin: 'microphoneData',
  kI2sWordSelectPin: 'i2sWordSelect',
  kI2sBitClockPin: 'i2sBitClock',
  kAmplifierDataPin: 'amplifierData',
  kDisplayClockPin: 'displayClock',
  kDisplayMisoPin: 'displayMiso',
  kDisplayMosiPin: 'displayMosi',
  kI2cSclPin: 'i2cScl',
  kI2cSdaPin: 'i2cSda',
  kDisplayResetPin: 'displayReset',
};

const repositoryRoot = path.join(__dirname, '..', '..');

function parseFirmwarePinContract(): Record<string, number> {
  const headerPath = path.join(repositoryRoot, 'firmware', 'morgan_badge', 'board_config.h');
  const header = fs.readFileSync(headerPath, 'utf8');
  const pattern = /constexpr\s+(?:uint8_t|int8_t)\s+(k\w+Pin)\s*=\s*(D\d+|\d+)\s*;/g;
  const resolved: Record<string, number> = {};
  for (const match of header.matchAll(pattern)) {
    const [, name, value] = match;
    const gpio = value.startsWith('D') ? XIAO_PAD_TO_GPIO[value] : Number(value);
    assert.ok(gpio !== undefined, `Unknown pad alias ${value} for ${name}`);
    resolved[name] = gpio;
  }
  return resolved;
}

test('badge component emulator', async (suite) => {
  await suite.test('firmware header, emulator map, and wiring CSV agree', () => {
    // board_config.h is the authoritative pin contract. This closes the loop so
    // that editing the header without updating the emulator or the document the
    // badge is soldered from fails the build instead of drifting silently.
    const firmwarePins = parseFirmwarePinContract();

    for (const [constant, pinName] of Object.entries(FIRMWARE_PIN_BINDINGS)) {
      assert.ok(constant in firmwarePins, `board_config.h is missing ${constant}`);
      assert.equal(
        firmwarePins[constant],
        PIN_MAP[pinName].gpio,
        `${constant} resolves to gpio${firmwarePins[constant]} but the emulator says gpio${PIN_MAP[pinName].gpio}`,
      );
    }

    const csv = fs.readFileSync(
      path.join(repositoryRoot, 'hardware', 'morgan-badge-rev-a-wiring.csv'),
      'utf8',
    );
    for (const [pinName, pin] of Object.entries(PIN_MAP)) {
      if (pinName === 'displayMiso') continue; // Optional readback line.
      // Delimited match so GPIO1 cannot be satisfied by GPIO10/11/12.
      assert.ok(
        new RegExp(`GPIO${pin.gpio}(?!\\d)`).test(csv),
        `wiring CSV never mentions GPIO${pin.gpio} for ${pinName}`,
      );
      assert.ok(
        csv.includes(pin.net),
        `wiring CSV never mentions net ${pin.net}`,
      );
    }
  });

  await suite.test('matches the Rev A.1 XIAO pin contract', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(PIN_MAP).map(([name, pin]) => [name, [pin.pad, pin.gpio, pin.direction]])),
      {
        ptt: ['D0', 1, 'input'],
        amplifierSd: ['D1', 0, 'output'],
        displayDc: ['D2', 25, 'output'],
        displayCs: ['D3', 7, 'output'],
        microphoneData: ['D4', 23, 'input'],
        i2sWordSelect: ['D5', 24, 'output'],
        i2sBitClock: ['D6', 11, 'output'],
        amplifierData: ['D7', 12, 'output'],
        displayClock: ['D8', 8, 'output'],
        displayMiso: ['D9', 9, 'input'],
        displayMosi: ['D10', 10, 'output'],
        i2cScl: ['MTDI', 3, 'output'],
        i2cSda: ['MTCK', 4, 'bidirectional'],
        displayReset: ['MTDO', 5, 'output'],
      },
    );
  });

  await suite.test('keeps externally pulled nets off ESP32-C5 strapping pins', () => {
    // GPIO2, 7, 25, 27 and 28 latch boot configuration. Only nets that drive a
    // high-impedance module input may use them, because the chip's ~45k
    // internal pull would fight any external resistor at reset.
    const strapping = new Set([2, 7, 25, 27, 28]);
    const externallyPulled = ['ptt', 'amplifierSd', 'i2cScl', 'i2cSda', 'displayReset'];
    for (const name of externallyPulled) {
      assert.ok(
        !strapping.has(PIN_MAP[name].gpio),
        `${name} carries an external pull and must not use strapping gpio${PIN_MAP[name].gpio}`,
      );
    }
  });

  await suite.test('boots and passes every core component baseline check', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    assert.equal(emulator.state, STATES.STANDBY);
    const result = emulator.runValidation();
    assert.equal(result.pass, true);
    // Core components must be soldered for the badge to work; the optional Rev B
    // modules are counted separately so they cannot inflate the baseline.
    assert.equal(result.passed, 9);
    assert.equal(result.total, 9);
    assert.equal(result.optionalTotal, 3);
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

  await suite.test('reports optional peripherals as unfitted until they are added', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    // The Rev B daughterboard is not fitted by default, matching what the
    // firmware reports on a bare board. Nothing may claim these are working.
    for (const id of ['nfc', 'imu', 'haptic']) {
      const check = emulator.checkById(id);
      assert.equal(check.pass, false, `${id} must not pass while unfitted`);
      assert.equal(check.optional, true, `${id} must be marked optional`);
    }
    assert.equal(emulator.tapNfc(true), false);
    assert.equal(emulator.setTilt(40, 0), false);
  });

  await suite.test('exercises optional NFC, IMU, and haptic behaviors once fitted', () => {
    const emulator = new BadgeEmulator();
    emulator.advance(500);
    emulator.optionals.nfc.connected = true;
    emulator.optionals.imu.connected = true;
    emulator.optionals.haptic.connected = true;
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

  await suite.test('ships Solara shell, microphone, transcript, and speaker controls', () => {
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
    assert.match(html, /class="badge-rig"/);
    assert.match(html, /class="microsoft-mark"/);
    assert.match(html, /class="screen-role">Digital CFO</);
  });
});
