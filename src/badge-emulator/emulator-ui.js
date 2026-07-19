(function startBadgeTestBench() {
  'use strict';

  const { BadgeEmulator, STATES, PIN_MAP, HAPTIC_PATTERNS, DEFAULT_FAULTS } = window.MorganBadgeEmulator;
  const emulator = new BadgeEmulator();
  let latestSnapshot = emulator.snapshot();
  let lastTestResult = null;
  let pttHeld = false;

  const byId = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const formatTime = (milliseconds) => {
    const seconds = milliseconds / 1000;
    return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
  };

  function render(snapshot) {
    latestSnapshot = snapshot;
    renderHeader(snapshot);
    renderBadge(snapshot);
    renderComponents(snapshot);
    renderMetrics(snapshot);
    renderFaults(snapshot);
    renderTelemetry();
    renderWaveform(snapshot);
    renderLog(snapshot);
  }

  function renderHeader(snapshot) {
    const chip = byId('state-chip');
    chip.textContent = snapshot.state;
    chip.className = `state-chip ${snapshot.state.toLowerCase()}`;
  }

  function renderBadge(snapshot) {
    byId('screen-state').textContent = snapshot.overlay || snapshot.state;
    byId('screen-detail').textContent = snapshot.detail;
    byId('screen-cloud').textContent = snapshot.network.connected && snapshot.network.authenticated ? 'CLOUD' : 'LOCAL';
    byId('screen-battery').textContent = `${snapshot.power.batteryVoltage.toFixed(2)} V`;
    byId('badge-led').classList.toggle('on', snapshot.xiao.ledOn);
    byId('ptt-button').classList.toggle('pressed', snapshot.stablePtt || pttHeld);
    const displayReady = snapshot.checks.find((check) => check.id === 'display').pass;
    byId('portrait-wrap').classList.toggle('disconnected', !displayReady);
    byId('display-status').textContent = displayReady ? 'READY' : 'FAILED';
    byId('display-status').className = displayReady ? 'result-pass' : 'result-fail';
    const overlay = byId('screen-overlay');
    overlay.className = 'overlay';
    overlay.textContent = snapshot.overlay || '';
    if (snapshot.overlay) overlay.classList.add('active', snapshot.overlay === 'ALERT' ? 'alert' : 'access');
  }

  function renderComponents(snapshot) {
    const grid = byId('component-grid');
    grid.replaceChildren(...snapshot.checks.map((check) => {
      const element = document.createElement('div');
      element.className = `component ${check.pass ? 'pass' : 'fail'}`;
      element.dataset.component = check.id;
      element.innerHTML = `<div class="component-top"><span class="status-dot"></span><b>${escapeHtml(check.label)}</b></div><p>${escapeHtml(check.detail)}</p>`;
      return element;
    }));
    const passed = snapshot.checks.filter((check) => check.pass).length;
    byId('component-score').textContent = `${passed} / ${snapshot.checks.length}`;
  }

  function renderMetrics(snapshot) {
    byId('metric-uptime').textContent = formatTime(snapshot.clockMs);
    byId('metric-state-age').textContent = `${Math.round(snapshot.clockMs - snapshot.stateEnteredMs)} ms`;
    byId('metric-led').textContent = snapshot.xiao.ledOn ? 'ON' : 'OFF';
    byId('metric-battery').textContent = `${Math.round(snapshot.power.batterySoc * 100)}%`;
    byId('metric-voltage').textContent = `${snapshot.power.batteryVoltage.toFixed(2)} V`;
    byId('metric-current').textContent = `${snapshot.power.currentMa.toFixed(1)} mA`;
    byId('metric-rssi').textContent = snapshot.network.connected ? `${snapshot.network.rssiDbm} dBm` : 'offline';
    byId('battery-soc-value').textContent = `${Math.round(snapshot.power.batterySoc * 100)}%`;
    byId('rssi-value').textContent = `${snapshot.network.rssiDbm} dBm`;
    byId('audio-measurement').textContent = `RMS ${snapshot.microphone.lastRms.toFixed(3)} · peak ${snapshot.microphone.lastPeak.toFixed(3)}`;
    byId('nfc-result').textContent = snapshot.optionals.nfc.lastResult;
    byId('haptic-result').textContent = snapshot.optionals.haptic.lastEffect || 'idle';
  }

  function renderFaults(snapshot) {
    for (const [name, enabled] of Object.entries(snapshot.faults)) {
      const input = document.querySelector(`[data-fault="${name}"]`);
      if (input) input.checked = enabled;
    }
  }

  function renderTelemetry() {
    byId('telemetry-preview').textContent = JSON.stringify(emulator.telemetry(), null, 2);
  }

  function renderWaveform(snapshot) {
    const canvas = byId('waveform');
    const context = canvas.getContext('2d');
    const { samples, rms, peak } = emulator.generateMicrophoneSamples(480);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = css('--cp-surface-soft');
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = css('--cp-border');
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, canvas.height / 2);
    context.lineTo(canvas.width, canvas.height / 2);
    context.stroke();
    context.strokeStyle = snapshot.checks.find((check) => check.id === 'microphone').pass ? css('--cp-accent') : css('--cp-danger');
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index < samples.length; index += 1) {
      const x = index / (samples.length - 1) * canvas.width;
      const y = canvas.height / 2 - samples[index] / 32768 * canvas.height * 0.42;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    byId('pcm-label').textContent = `24 kHz · PCM16 · RMS ${rms.toFixed(3)} · peak ${peak.toFixed(3)}`;
  }

  function renderLog(snapshot) {
    const log = byId('event-log');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
    log.replaceChildren(...snapshot.events.slice().reverse().map((event) => {
      const row = document.createElement('div');
      row.className = `log-row ${event.status}`;
      row.innerHTML = `<span class="log-time">${(event.atMs / 1000).toFixed(3)}s</span><span class="log-tag">${escapeHtml(event.tag)}</span><span>${escapeHtml(event.message)}</span>`;
      return row;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function renderTestResults(result, kind) {
    lastTestResult = result;
    const rows = kind === 'faults'
      ? result.results.map((entry) => ({ label: entry.fault, pass: entry.detected, detail: `Detector: ${entry.component}` }))
      : result.checks.map((entry) => ({ label: entry.label, pass: entry.pass, detail: entry.detail }));
    byId('test-results').replaceChildren(...rows.map((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(row.label)}</td><td class="${row.pass ? 'result-pass' : 'result-fail'}">${row.pass ? 'PASS' : 'FAIL'}</td><td>${escapeHtml(row.detail)}</td>`;
      return tr;
    }));
    const passed = kind === 'faults' ? result.detected : result.passed;
    byId('test-summary').textContent = `${passed} / ${result.total} ${result.pass ? 'PASS' : 'FAIL'}`;
    byId('test-summary').className = result.pass ? 'result-pass' : 'result-fail';
  }

  function runValidation() {
    const result = emulator.runValidation();
    renderTestResults(result, 'baseline');
    return result;
  }

  function runFaultMatrix() {
    const result = emulator.runFaultMatrix();
    renderTestResults(result, 'faults');
    return result;
  }

  function pressPtt() {
    if (pttHeld) return;
    pttHeld = true;
    emulator.pressPtt();
  }

  function releasePtt() {
    if (!pttHeld) return;
    pttHeld = false;
    emulator.releasePtt();
  }

  function playBrowserTone() {
    const amp = latestSnapshot.checks.find((check) => check.id === 'amplifier');
    const speaker = latestSnapshot.checks.find((check) => check.id === 'speaker');
    if (!amp.pass || !speaker.pass) {
      emulator.playPcm(new Int16Array(240));
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = 523.25;
    gain.gain.value = 0.08 * latestSnapshot.amplifier.gain;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.18);
    oscillator.addEventListener('ended', () => audioContext.close());
    emulator.playPcm(emulator.generateMicrophoneSamples(240, 523.25).samples);
  }

  async function probeHealth() {
    const result = byId('health-result');
    result.className = 'result-pending';
    result.textContent = 'Probing…';
    try {
      const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok || payload.status !== 'healthy') throw new Error(`HTTP ${response.status}`);
      result.className = 'result-pass';
      result.textContent = `${payload.agent} ${payload.status}`;
    } catch (error) {
      result.className = 'result-fail';
      result.textContent = error instanceof Error ? error.message : 'Unavailable';
    }
  }

  function buildFaultControls() {
    const labels = {
      mcuFault: 'MCU self-test failure',
      displayDisconnected: 'Display disconnected',
      spiClockOpen: 'LCD SCK open',
      spiMosiOpen: 'LCD MOSI open',
      micDisconnected: 'Microphone disconnected',
      micSlotWrong: 'Mic L/R slot wrong',
      micClipping: 'Microphone clipping',
      i2sBclkOpen: 'I2S BCLK open',
      i2sLrclkOpen: 'I2S LRCLK open',
      ampDisconnected: 'Amplifier disconnected',
      ampSdStuckLow: 'AMP_SD stuck low',
      speakerOpen: 'Speaker open circuit',
      speakerShort: 'Speaker short',
      pttStuckLow: 'PTT stuck low',
      pttStuckHigh: 'PTT stuck high',
      batteryBrownout: 'Battery brownout',
      chargerFault: 'Charger fault',
      wifiDown: 'Wi-Fi unavailable',
      tlsInvalid: 'TLS root invalid',
      authInvalid: 'Badge key rejected',
      cloudDown: 'Cloud unavailable',
      nfcDisconnected: 'PN532 disconnected',
      imuDisconnected: 'MPU6050 disconnected',
      hapticDisconnected: 'DRV2605L disconnected',
    };
    byId('fault-grid').replaceChildren(...Object.keys(DEFAULT_FAULTS).map((name) => {
      const label = document.createElement('label');
      label.className = 'switch-row';
      label.innerHTML = `<span>${escapeHtml(labels[name] || name)}</span><input type="checkbox" data-fault="${name}">`;
      label.querySelector('input').addEventListener('change', (event) => emulator.setFault(name, event.target.checked));
      return label;
    }));
  }

  function buildWiringTable() {
    byId('wiring-table').replaceChildren(...Object.entries(PIN_MAP).map(([name, pin]) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${escapeHtml(name)}</td><td><code>${pin.pad}</code></td><td>${pin.gpio}</td><td><code>${pin.net}</code></td><td>${pin.direction}</td>`;
      return row;
    }));
  }

  function bindControls() {
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((candidate) => candidate.classList.toggle('active', candidate === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `panel-${tab.dataset.tab}`));
    }));
    byId('run-validation').addEventListener('click', runValidation);
    byId('run-fault-matrix').addEventListener('click', runFaultMatrix);
    byId('fault-matrix-panel').addEventListener('click', runFaultMatrix);
    byId('reset-emulator').addEventListener('click', () => {
      emulator.reset();
      lastTestResult = null;
      byId('test-results').innerHTML = '<tr><td colspan="3" class="empty">Run validation or the fault matrix.</td></tr>';
      byId('test-summary').textContent = 'Not run';
      byId('test-summary').className = 'result-pending';
    });
    byId('clear-faults').addEventListener('click', () => emulator.clearFaults());
    byId('clear-log').addEventListener('click', () => { emulator.events.length = 0; emulator.emit(); });
    byId('ptt-button').addEventListener('pointerdown', (event) => { event.currentTarget.setPointerCapture(event.pointerId); pressPtt(); });
    byId('ptt-button').addEventListener('pointerup', releasePtt);
    byId('ptt-button').addEventListener('pointercancel', releasePtt);
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'Space' || event.repeat || /INPUT|SELECT|BUTTON/.test(event.target.tagName)) return;
      event.preventDefault();
      pressPtt();
    });
    window.addEventListener('keyup', (event) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      releasePtt();
    });
    document.querySelectorAll('[data-state]').forEach((button) => button.addEventListener('click', () => emulator.enterState(STATES[button.dataset.state], 'Bench command')));
    byId('mic-level').addEventListener('input', (event) => {
      const level = Number(event.target.value) / 100;
      byId('mic-level-value').textContent = `${event.target.value}%`;
      emulator.setMicrophone(level, Number(byId('mic-noise').value) / 100);
    });
    byId('mic-noise').addEventListener('input', (event) => {
      byId('mic-noise-value').textContent = `${(Number(event.target.value)).toFixed(1)}%`;
      emulator.setMicrophone(Number(byId('mic-level').value) / 100, Number(event.target.value) / 100);
    });
    byId('amp-gain').addEventListener('input', (event) => {
      byId('amp-gain-value').textContent = `${event.target.value}%`;
      emulator.setAmplifierGain(Number(event.target.value) / 100);
    });
    byId('sample-mic').addEventListener('click', () => { emulator.generateMicrophoneSamples(240); emulator.emit(); });
    byId('speaker-test').addEventListener('click', playBrowserTone);
    byId('battery-soc').addEventListener('input', (event) => emulator.setBatterySoc(event.target.value));
    byId('rssi').addEventListener('input', (event) => emulator.setRssi(event.target.value));
    byId('usb-connected').addEventListener('change', (event) => emulator.setUsbConnected(event.target.checked));
    byId('wifi-enabled').addEventListener('change', (event) => { emulator.network.enabled = event.target.checked; emulator.emit(); });
    byId('wifi-connected').addEventListener('change', (event) => { emulator.network.connected = event.target.checked; emulator.emit(); });
    byId('clock-synchronized').addEventListener('change', (event) => { emulator.network.clockSynchronized = event.target.checked; emulator.emit(); });
    byId('tls-valid').addEventListener('change', (event) => { emulator.network.tlsValid = event.target.checked; emulator.faults.tlsInvalid = !event.target.checked; emulator.emit(); });
    byId('auth-valid').addEventListener('change', (event) => { emulator.network.authenticated = event.target.checked; emulator.faults.authInvalid = !event.target.checked; emulator.emit(); });
    byId('voice-configured').addEventListener('change', (event) => { emulator.network.voiceConfigured = event.target.checked; emulator.emit(); });
    byId('live-health').addEventListener('click', probeHealth);
    byId('nfc-authorized').addEventListener('click', () => emulator.tapNfc(true));
    byId('nfc-denied').addEventListener('click', () => emulator.tapNfc(false));
    const updateTilt = () => {
      const pitch = Number(byId('pitch').value);
      const roll = Number(byId('roll').value);
      byId('pitch-value').textContent = `${pitch}°`;
      byId('roll-value').textContent = `${roll}°`;
      emulator.setTilt(pitch, roll);
    };
    byId('pitch').addEventListener('input', updateTilt);
    byId('roll').addEventListener('input', updateTilt);
    document.querySelectorAll('[data-haptic]').forEach((button) => button.addEventListener('click', () => {
      const pattern = emulator.playHaptic(button.dataset.haptic);
      if (pattern && navigator.vibrate) navigator.vibrate(pattern.durations);
    }));
    byId('copy-telemetry').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(emulator.telemetry(), null, 2)); } catch { /* clipboard can be unavailable */ }
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  buildFaultControls();
  buildWiringTable();
  bindControls();
  emulator.subscribe(render);
  emulator.advance(500);
  setInterval(() => emulator.advance(100), 100);

  window.__badgeEmulator = emulator;
  window.__badgeEmulatorUi = { runValidation, runFaultMatrix, pressPtt, releasePtt, getLastTestResult: () => lastTestResult };
})();
