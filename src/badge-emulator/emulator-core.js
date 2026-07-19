(function attachMorganBadgeEmulator(globalScope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (globalScope) globalScope.MorganBadgeEmulator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const STATES = Object.freeze({
    BOOT: 'BOOT',
    STANDBY: 'STANDBY',
    LISTENING: 'LISTENING',
    THINKING: 'THINKING',
    SPEAKING: 'SPEAKING',
    FAULT: 'FAULT',
  });

  const PIN_MAP = Object.freeze({
    ptt: Object.freeze({ pad: 'D0', gpio: 1, net: 'PTT_N', direction: 'input' }),
    displayCs: Object.freeze({ pad: 'D1', gpio: 0, net: 'LCD_CS', direction: 'output' }),
    displayDc: Object.freeze({ pad: 'D2', gpio: 25, net: 'LCD_DC', direction: 'output' }),
    amplifierSd: Object.freeze({ pad: 'D3', gpio: 7, net: 'AMP_SD', direction: 'output' }),
    microphoneData: Object.freeze({ pad: 'D4', gpio: 23, net: 'MIC_SD', direction: 'input' }),
    i2sWordSelect: Object.freeze({ pad: 'D5', gpio: 24, net: 'I2S_LRCLK', direction: 'output' }),
    i2sBitClock: Object.freeze({ pad: 'D6', gpio: 11, net: 'I2S_BCLK', direction: 'output' }),
    amplifierData: Object.freeze({ pad: 'D7', gpio: 12, net: 'AMP_DIN', direction: 'output' }),
    displayClock: Object.freeze({ pad: 'D8', gpio: 8, net: 'LCD_SCK', direction: 'output' }),
    statusLed: Object.freeze({ pad: 'D9', gpio: 9, net: 'STATUS_D9', direction: 'reserved' }),
    displayMosi: Object.freeze({ pad: 'D10', gpio: 10, net: 'LCD_MOSI', direction: 'output' }),
  });

  const DEFAULT_FAULTS = Object.freeze({
    mcuFault: false,
    displayDisconnected: false,
    spiClockOpen: false,
    spiMosiOpen: false,
    micDisconnected: false,
    micSlotWrong: false,
    micClipping: false,
    i2sBclkOpen: false,
    i2sLrclkOpen: false,
    ampDisconnected: false,
    ampSdStuckLow: false,
    speakerOpen: false,
    speakerShort: false,
    pttStuckLow: false,
    pttStuckHigh: false,
    batteryBrownout: false,
    chargerFault: false,
    wifiDown: false,
    tlsInvalid: false,
    authInvalid: false,
    cloudDown: false,
    nfcDisconnected: false,
    imuDisconnected: false,
    hapticDisconnected: false,
  });

  const HAPTIC_PATTERNS = Object.freeze({
    click: Object.freeze({ effectId: '0x01', durations: Object.freeze([30]) }),
    ramp: Object.freeze({ effectId: '0x0A', durations: Object.freeze([20, 20, 80, 20, 60]) }),
    alert: Object.freeze({ effectId: 'triple-pulse', durations: Object.freeze([90, 70, 90, 70, 130]) }),
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  class BadgeEmulator {
    constructor(options = {}) {
      this.options = {
        batteryCapacityMah: Number(options.batteryCapacityMah || 600),
        bootDelayMs: Number(options.bootDelayMs || 500),
        cloudThinkingMs: Number(options.cloudThinkingMs || 650),
        offlineThinkingMs: Number(options.offlineThinkingMs || 900),
        speakingMs: Number(options.speakingMs || 1100),
      };
      this.listeners = new Set();
      this.reset();
    }

    reset() {
      this.clockMs = 0;
      this.stateEnteredMs = 0;
      this.state = STATES.BOOT;
      this.detail = 'Hardware self-test';
      this.overlay = null;
      this.rawPtt = false;
      this.stablePtt = false;
      this.voiceConnected = false;
      this.awaitingResponse = false;
      this.timers = [];
      this.events = [];
      this.faults = { ...DEFAULT_FAULTS };
      this.xiao = {
        chip: 'ESP32-C5',
        revision: 1,
        cpuMHz: 240,
        flashBytes: 8 * 1024 * 1024,
        psramBytes: 8 * 1024 * 1024,
        freeHeapBytes: 270588,
        ledOn: true,
      };
      this.display = {
        connected: true,
        width: 240,
        height: 320,
        controller: 'ST7789',
        backlight: true,
        frameCount: 0,
      };
      this.microphone = {
        connected: true,
        model: 'ICS-43434',
        sampleRate: 24000,
        slot: 'left',
        level: 0.42,
        noise: 0.015,
        frequencyHz: 220,
        lastRms: 0,
        lastPeak: 0,
      };
      this.amplifier = {
        connected: true,
        model: 'MAX98357A',
        enabled: false,
        gain: 0.35,
        lastRms: 0,
      };
      this.speaker = {
        connected: true,
        model: '1511 dynamic speaker',
        impedanceOhms: 8,
        audible: false,
      };
      this.power = {
        usbConnected: true,
        batteryPresent: true,
        batterySoc: 0.86,
        batteryVoltage: 4.06,
        charging: true,
        currentMa: 0,
        temperatureC: 24,
      };
      this.network = {
        enabled: true,
        connected: true,
        rssiDbm: -57,
        clockSynchronized: true,
        tlsValid: true,
        authenticated: true,
        cloudAvailable: true,
        voiceConfigured: true,
        latencyMs: 85,
        lastHttpCode: 200,
        telemetryHttpCode: 202,
      };
      this.optionals = {
        nfc: { connected: true, model: 'PN532', lastResult: 'idle' },
        imu: { connected: true, model: 'MPU6050', pitch: 0, roll: 0, interrupt: false },
        haptic: { connected: true, model: 'DRV2605L', lastEffect: null },
      };
      this.log('BOOT', 'ESP32-C5 emulator reset', 'ok');
      this.schedule(this.options.bootDelayMs, () => {
        if (this.faults.mcuFault) this.enterState(STATES.FAULT, 'MCU self-test failed');
        else this.enterState(STATES.STANDBY, 'Ready - emulated hardware');
      }, 'boot-complete');
      this.emit();
    }

    subscribe(listener) {
      this.listeners.add(listener);
      listener(this.snapshot());
      return () => this.listeners.delete(listener);
    }

    emit() {
      const snapshot = this.snapshot();
      for (const listener of this.listeners) listener(snapshot);
    }

    log(tag, message, status = 'info', data = {}) {
      this.events.push({ atMs: Math.round(this.clockMs), tag, message, status, data: copy(data) });
      if (this.events.length > 250) this.events.splice(0, this.events.length - 250);
    }

    schedule(delayMs, callback, label = 'timer') {
      const timer = { atMs: this.clockMs + Math.max(0, delayMs), callback, label };
      this.timers.push(timer);
      this.timers.sort((left, right) => left.atMs - right.atMs);
      return timer;
    }

    cancelTimer(label) {
      this.timers = this.timers.filter((timer) => timer.label !== label);
    }

    advance(durationMs) {
      const targetMs = this.clockMs + Math.max(0, Number(durationMs || 0));
      while (this.timers.length && this.timers[0].atMs <= targetMs) {
        const timer = this.timers.shift();
        this.updatePower(timer.atMs - this.clockMs);
        this.clockMs = timer.atMs;
        timer.callback();
      }
      this.updatePower(targetMs - this.clockMs);
      this.clockMs = targetMs;
      this.display.frameCount += 1;
      this.emit();
      return this.snapshot();
    }

    updatePower(durationMs) {
      if (durationMs <= 0) return;
      const stateLoads = {
        [STATES.BOOT]: 95,
        [STATES.STANDBY]: 62,
        [STATES.LISTENING]: 158,
        [STATES.THINKING]: 132,
        [STATES.SPEAKING]: 310,
        [STATES.FAULT]: 48,
      };
      let loadMa = stateLoads[this.state] || 70;
      if (!this.display.backlight || this.faults.displayDisconnected) loadMa -= 42;
      if (!this.network.enabled || this.faults.wifiDown) loadMa -= 24;
      if (this.amplifier.enabled) loadMa += 95 * this.amplifier.gain;
      const chargingMa = this.power.usbConnected && this.power.batteryPresent && !this.faults.chargerFault
        ? Math.min(300, Math.max(0, (1 - this.power.batterySoc) * 500))
        : 0;
      this.power.currentMa = Math.round((loadMa - chargingMa) * 10) / 10;
      this.power.charging = chargingMa > loadMa;

      if (this.power.batteryPresent) {
        const netBatteryMa = this.power.usbConnected ? loadMa - chargingMa : loadMa;
        const deltaMah = netBatteryMa * durationMs / 3600000;
        this.power.batterySoc = clamp(
          this.power.batterySoc - deltaMah / this.options.batteryCapacityMah,
          0,
          1,
        );
      }
      const openCircuitVoltage = 3.2 + this.power.batterySoc;
      const sag = this.power.usbConnected ? 0 : Math.max(0, loadMa - 50) * 0.00035;
      this.power.batteryVoltage = this.faults.batteryBrownout
        ? 3.05
        : this.power.usbConnected
          ? Math.max(openCircuitVoltage, 4.03)
          : Math.max(3.0, openCircuitVoltage - sag);
      this.power.temperatureC = clamp(24 + Math.max(0, loadMa - 150) * 0.012, 20, 55);
      if (!this.power.usbConnected && this.power.batteryVoltage < 3.15 && this.state !== STATES.FAULT) {
        this.enterState(STATES.FAULT, 'Brownout protection');
      }
    }

    enterState(nextState, detail) {
      this.state = nextState;
      this.detail = detail;
      this.stateEnteredMs = this.clockMs;
      this.xiao.ledOn = nextState !== STATES.STANDBY;
      this.amplifier.enabled = nextState === STATES.SPEAKING && this.checkById('amplifier').pass;
      this.speaker.audible = this.amplifier.enabled && this.checkById('speaker').pass;
      this.log('STATE', `${nextState}: ${detail}`, nextState === STATES.FAULT ? 'error' : 'ok');
      this.emit();
    }

    setFault(name, enabled = true) {
      if (!(name in this.faults)) throw new Error(`Unknown fault: ${name}`);
      this.faults[name] = Boolean(enabled);
      if (name === 'wifiDown') this.network.connected = !enabled;
      if (name === 'tlsInvalid') this.network.tlsValid = !enabled;
      if (name === 'authInvalid') this.network.authenticated = !enabled;
      if (name === 'cloudDown') this.network.cloudAvailable = !enabled;
      this.log('FAULT', `${name}=${Boolean(enabled)}`, enabled ? 'warn' : 'ok');
      this.emit();
    }

    clearFaults() {
      for (const name of Object.keys(this.faults)) this.faults[name] = false;
      this.network.connected = true;
      this.network.tlsValid = true;
      this.network.authenticated = true;
      this.network.cloudAvailable = true;
      this.log('FAULT', 'All injected faults cleared', 'ok');
      this.emit();
    }

    setUsbConnected(connected) {
      this.power.usbConnected = Boolean(connected);
      this.log('PWR', `USB ${connected ? 'connected' : 'disconnected'}`, 'info');
      this.emit();
    }

    setBatterySoc(percent) {
      this.power.batterySoc = clamp(Number(percent) / 100, 0, 1);
      this.updatePower(1);
      this.log('PWR', `Battery set to ${Math.round(this.power.batterySoc * 100)}%`, 'info');
      this.emit();
    }

    setRssi(rssiDbm) {
      this.network.rssiDbm = clamp(Number(rssiDbm), -127, -20);
      this.log('NET', `RSSI set to ${this.network.rssiDbm} dBm`, this.network.rssiDbm < -85 ? 'warn' : 'info');
      this.emit();
    }

    setMicrophone(level, noise) {
      this.microphone.level = clamp(Number(level), 0, 1.5);
      this.microphone.noise = clamp(Number(noise), 0, 0.5);
      this.emit();
    }

    setAmplifierGain(gain) {
      this.amplifier.gain = clamp(Number(gain), 0, 1);
      this.emit();
    }

    voiceReady() {
      const cloud = this.checkById('cloud');
      return cloud.pass && this.network.voiceConfigured;
    }

    pressPtt() {
      if (this.faults.pttStuckHigh) {
        this.log('PTT', 'Press ignored: line stuck high', 'error');
        this.emit();
        return;
      }
      this.rawPtt = true;
      this.log('PTT', 'Raw press', 'info');
      this.cancelTimer('ptt-debounce');
      this.schedule(35, () => {
        if (!this.rawPtt && !this.faults.pttStuckLow) return;
        this.stablePtt = true;
        if (this.voiceReady() && this.checkById('microphone').pass) {
          this.voiceConnected = true;
          this.enterState(STATES.LISTENING, 'Speak now');
          this.log('NET', 'Tool-free badge voice connected', 'ok');
        } else {
          this.voiceConnected = false;
          this.enterState(STATES.LISTENING, 'Push-to-talk - local mode');
        }
      }, 'ptt-debounce');
      this.emit();
    }

    releasePtt() {
      if (this.faults.pttStuckLow) {
        this.log('PTT', 'Release ignored: line stuck low', 'error');
        this.emit();
        return;
      }
      this.rawPtt = false;
      this.log('PTT', 'Raw release', 'info');
      this.cancelTimer('ptt-debounce');
      this.schedule(35, () => {
        if (this.rawPtt || !this.stablePtt) return;
        this.stablePtt = false;
        if (this.state !== STATES.LISTENING) return;
        const cloudPath = this.voiceConnected;
        this.voiceConnected = false;
        this.awaitingResponse = cloudPath;
        this.enterState(STATES.THINKING, cloudPath ? 'Morgan is thinking' : 'Local prototype response');
        this.schedule(
          cloudPath ? this.options.cloudThinkingMs : this.options.offlineThinkingMs,
          () => {
            this.awaitingResponse = false;
            this.enterState(STATES.SPEAKING, cloudPath ? 'Morgan is speaking' : 'Cloud not configured');
            const tone = this.generateMicrophoneSamples(240, 523.25);
            this.playPcm(tone.samples);
            this.schedule(this.options.speakingMs, () => {
              this.amplifier.enabled = false;
              this.speaker.audible = false;
              this.enterState(STATES.STANDBY, 'Ready');
            }, 'speaking-complete');
          },
          'thinking-complete',
        );
      }, 'ptt-debounce');
      this.emit();
    }

    generateMicrophoneSamples(sampleCount = 240, frequencyHz = this.microphone.frequencyHz) {
      const samples = new Int16Array(sampleCount);
      const micReady = this.checkById('microphone').pass;
      let sumSquares = 0;
      let peak = 0;
      for (let index = 0; index < sampleCount; index += 1) {
        const phase = 2 * Math.PI * frequencyHz * (index / this.microphone.sampleRate);
        const deterministicNoise = Math.sin(index * 12.9898) * this.microphone.noise;
        const amplitude = this.faults.micClipping ? 1.35 : this.microphone.level;
        const normalized = micReady ? clamp(Math.sin(phase) * amplitude + deterministicNoise, -1, 1) : 0;
        const value = Math.round(normalized * 32767);
        samples[index] = value;
        sumSquares += normalized * normalized;
        peak = Math.max(peak, Math.abs(normalized));
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
      this.microphone.lastRms = rms;
      this.microphone.lastPeak = peak;
      return { samples, rms, peak, clipped: peak >= 0.999 };
    }

    playPcm(samples) {
      const amplifier = this.checkById('amplifier');
      const speaker = this.checkById('speaker');
      if (!amplifier.pass || !speaker.pass || !samples || !samples.length) {
        this.amplifier.enabled = false;
        this.speaker.audible = false;
        this.log('AUDIO', 'PCM playback blocked by component fault', 'error');
        return { audible: false, rms: 0 };
      }
      let sumSquares = 0;
      for (const sample of samples) {
        const normalized = sample / 32768;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / samples.length) * this.amplifier.gain;
      this.amplifier.enabled = true;
      this.amplifier.lastRms = rms;
      this.speaker.audible = rms > 0.001;
      this.log('AUDIO', `PCM playback RMS ${rms.toFixed(3)}`, this.speaker.audible ? 'ok' : 'warn');
      this.emit();
      return { audible: this.speaker.audible, rms };
    }

    tapNfc(authorized) {
      const check = this.checkById('nfc');
      if (!check.pass) {
        this.optionals.nfc.lastResult = 'unavailable';
        this.log('NFC', 'PN532 tap failed: module unavailable', 'error');
        this.emit();
        return false;
      }
      this.optionals.nfc.lastResult = authorized ? 'authorized' : 'denied';
      this.overlay = authorized ? 'ACCESS' : 'ALERT';
      this.log('NFC', authorized ? 'Authorized tag accepted' : 'Unauthorized tag rejected', authorized ? 'ok' : 'error');
      this.playHaptic(authorized ? 'click' : 'alert');
      this.cancelTimer('overlay-clear');
      this.schedule(authorized ? 1800 : 3200, () => {
        this.overlay = null;
        this.emit();
      }, 'overlay-clear');
      this.emit();
      return authorized;
    }

    setTilt(pitch, roll) {
      const previousPitch = this.optionals.imu.pitch;
      this.optionals.imu.pitch = clamp(Number(pitch), -90, 90);
      this.optionals.imu.roll = clamp(Number(roll), -180, 180);
      const check = this.checkById('imu');
      const crossedThreshold = previousPitch <= 35 && this.optionals.imu.pitch > 35;
      this.optionals.imu.interrupt = check.pass && crossedThreshold;
      if (this.optionals.imu.interrupt) {
        this.log('IMU', `Motion interrupt at ${this.optionals.imu.pitch.toFixed(0)} degrees`, 'ok');
        this.playHaptic('click');
        if (this.state === STATES.STANDBY) this.detail = 'Tilt wake';
      }
      this.emit();
      return this.optionals.imu.interrupt;
    }

    playHaptic(patternName) {
      const check = this.checkById('haptic');
      const pattern = HAPTIC_PATTERNS[patternName];
      if (!pattern || !check.pass) {
        this.log('HAP', 'Haptic request failed', 'error');
        this.emit();
        return null;
      }
      this.optionals.haptic.lastEffect = patternName;
      this.log('HAP', `${pattern.effectId} ${patternName}`, 'ok', { durations: pattern.durations });
      this.emit();
      return pattern;
    }

    componentChecks() {
      const hasI2sClocks = !this.faults.i2sBclkOpen && !this.faults.i2sLrclkOpen;
      const batteryPowered = this.power.usbConnected || this.power.batteryPresent;
      const batterySafe = !this.faults.batteryBrownout && this.power.batteryVoltage >= 3.15;
      const wifiHealthy = this.network.enabled && this.network.connected && !this.faults.wifiDown && this.network.rssiDbm >= -90;
      return [
        { id: 'mcu', label: 'XIAO ESP32-C5', pass: !this.faults.mcuFault && this.xiao.flashBytes === 8388608 && this.xiao.psramBytes === 8388608, detail: '240 MHz, 8 MB flash, 8 MB PSRAM' },
        { id: 'display', label: 'ST7789 display', pass: this.display.connected && !this.faults.displayDisconnected && !this.faults.spiClockOpen && !this.faults.spiMosiOpen, detail: '240 x 320 SPI framebuffer' },
        { id: 'microphone', label: 'ICS-43434 microphone', pass: this.microphone.connected && !this.faults.micDisconnected && !this.faults.micSlotWrong && hasI2sClocks, detail: '24 kHz PCM16, left slot' },
        { id: 'amplifier', label: 'MAX98357A amplifier', pass: this.amplifier.connected && !this.faults.ampDisconnected && !this.faults.ampSdStuckLow && hasI2sClocks, detail: 'VBAT_RAW, differential output' },
        { id: 'speaker', label: '1511 speaker', pass: this.speaker.connected && !this.faults.speakerOpen && !this.faults.speakerShort, detail: `${this.speaker.impedanceOhms} ohm assumed` },
        { id: 'ptt', label: 'PTT switch', pass: !this.faults.pttStuckLow && !this.faults.pttStuckHigh, detail: 'D0 / GPIO1, 35 ms debounce' },
        { id: 'power', label: 'LiPo and SGM40567', pass: batteryPowered && batterySafe && !this.faults.chargerFault, detail: `${this.power.batteryVoltage.toFixed(2)} V, ${Math.round(this.power.batterySoc * 100)}%` },
        { id: 'wifi', label: 'Wi-Fi 6 radio', pass: wifiHealthy, detail: `${this.network.rssiDbm} dBm` },
        { id: 'cloud', label: 'TLS and badge API', pass: wifiHealthy && this.network.clockSynchronized && this.network.tlsValid && this.network.authenticated && this.network.cloudAvailable && !this.faults.tlsInvalid && !this.faults.authInvalid && !this.faults.cloudDown, detail: 'Pinned CA, HTTP 200 / telemetry 202' },
        { id: 'nfc', label: 'PN532 NFC', pass: this.optionals.nfc.connected && !this.faults.nfcDisconnected, detail: 'Optional Rev B peripheral' },
        { id: 'imu', label: 'MPU6050 IMU', pass: this.optionals.imu.connected && !this.faults.imuDisconnected, detail: 'Optional Rev B peripheral' },
        { id: 'haptic', label: 'DRV2605L haptic', pass: this.optionals.haptic.connected && !this.faults.hapticDisconnected, detail: 'Optional Rev B peripheral' },
      ];
    }

    checkById(id) {
      return this.componentChecks().find((check) => check.id === id) || { id, pass: false, detail: 'Unknown component' };
    }

    runValidation() {
      const checks = this.componentChecks();
      const mic = this.generateMicrophoneSamples(240);
      const microphone = checks.find((check) => check.id === 'microphone');
      if (microphone.pass && (mic.rms <= 0.01 || mic.clipped)) {
        microphone.pass = false;
        microphone.detail = mic.clipped ? 'Input clipping detected' : 'No usable PCM signal';
      }
      const audio = this.playPcm(mic.samples);
      const amplifier = checks.find((check) => check.id === 'amplifier');
      if (amplifier.pass && !audio.audible) {
        amplifier.pass = false;
        amplifier.detail = 'No audible PCM output';
      }
      const result = {
        atMs: this.clockMs,
        pass: checks.every((check) => check.pass),
        passed: checks.filter((check) => check.pass).length,
        total: checks.length,
        checks,
      };
      this.log('TEST', `Full validation ${result.passed}/${result.total}`, result.pass ? 'ok' : 'error');
      this.amplifier.enabled = false;
      this.speaker.audible = false;
      this.emit();
      return result;
    }

    runFaultMatrix() {
      const matrix = [
        ['mcuFault', 'mcu'],
        ['displayDisconnected', 'display'],
        ['spiClockOpen', 'display'],
        ['spiMosiOpen', 'display'],
        ['micDisconnected', 'microphone'],
        ['micSlotWrong', 'microphone'],
        ['micClipping', 'microphone-signal'],
        ['i2sBclkOpen', 'microphone'],
        ['i2sLrclkOpen', 'microphone'],
        ['ampDisconnected', 'amplifier'],
        ['ampSdStuckLow', 'amplifier'],
        ['speakerOpen', 'speaker'],
        ['speakerShort', 'speaker'],
        ['pttStuckLow', 'ptt'],
        ['pttStuckHigh', 'ptt'],
        ['batteryBrownout', 'power'],
        ['chargerFault', 'power'],
        ['wifiDown', 'wifi'],
        ['tlsInvalid', 'cloud'],
        ['authInvalid', 'cloud'],
        ['cloudDown', 'cloud'],
        ['nfcDisconnected', 'nfc'],
        ['imuDisconnected', 'imu'],
        ['hapticDisconnected', 'haptic'],
      ];
      const originalFaults = { ...this.faults };
      const originalNetwork = { ...this.network };
      const originalVoltage = this.power.batteryVoltage;
      const results = matrix.map(([fault, component]) => {
        this.faults[fault] = true;
        if (fault === 'wifiDown') this.network.connected = false;
        if (fault === 'tlsInvalid') this.network.tlsValid = false;
        if (fault === 'authInvalid') this.network.authenticated = false;
        if (fault === 'cloudDown') this.network.cloudAvailable = false;
        if (fault === 'batteryBrownout') this.power.batteryVoltage = 3.05;
        const detected = component === 'microphone-signal'
          ? this.generateMicrophoneSamples(240).clipped
          : !this.checkById(component).pass;
        this.faults[fault] = originalFaults[fault];
        Object.assign(this.network, originalNetwork);
        this.power.batteryVoltage = originalVoltage;
        return { fault, component, detected };
      });
      this.faults = originalFaults;
      Object.assign(this.network, originalNetwork);
      this.power.batteryVoltage = originalVoltage;
      const result = {
        pass: results.every((entry) => entry.detected),
        detected: results.filter((entry) => entry.detected).length,
        total: results.length,
        results,
      };
      this.log('TEST', `Fault matrix ${result.detected}/${result.total}`, result.pass ? 'ok' : 'error');
      this.emit();
      return result;
    }

    telemetry() {
      return {
        deviceId: 'morgan-emulator-c5',
        firmwareVersion: '0.1.0',
        state: this.state,
        batteryVolts: Number(this.power.batteryVoltage.toFixed(3)),
        batteryPresence: this.power.batteryPresent ? 'present' : 'absent',
        rssiDbm: this.network.connected ? Math.round(this.network.rssiDbm) : undefined,
        freeHeapBytes: this.xiao.freeHeapBytes,
        psramBytes: this.xiao.psramBytes,
        peripherals: {
          display: this.checkById('display').pass ? 'ready' : 'failed',
          microphone: this.checkById('microphone').pass ? 'ready' : 'failed',
          amplifier: this.checkById('amplifier').pass ? 'ready' : 'failed',
        },
      };
    }

    snapshot() {
      return copy({
        clockMs: this.clockMs,
        state: this.state,
        stateEnteredMs: this.stateEnteredMs,
        detail: this.detail,
        overlay: this.overlay,
        rawPtt: this.rawPtt,
        stablePtt: this.stablePtt,
        voiceConnected: this.voiceConnected,
        awaitingResponse: this.awaitingResponse,
        xiao: this.xiao,
        display: this.display,
        microphone: this.microphone,
        amplifier: this.amplifier,
        speaker: this.speaker,
        power: this.power,
        network: this.network,
        optionals: this.optionals,
        faults: this.faults,
        checks: this.componentChecks(),
        events: this.events,
        pinMap: PIN_MAP,
      });
    }
  }

  return { BadgeEmulator, STATES, PIN_MAP, HAPTIC_PATTERNS, DEFAULT_FAULTS };
});
