(function startBadgeTestBench() {
  'use strict';

  const { BadgeEmulator, STATES, PIN_MAP, HAPTIC_PATTERNS, DEFAULT_FAULTS } = window.MorganBadgeEmulator;
  const emulator = new BadgeEmulator();
  let latestSnapshot = emulator.snapshot();
  let lastTestResult = null;
  let pttHeld = false;
  let pttRequested = false;
  let voiceSocket = null;
  let voiceConnecting = false;
  let voiceSessionReady = false;
  let voiceIntentionalClose = false;
  let micStream = null;
  let micContext = null;
  let micSource = null;
  let micProcessor = null;
  let micSilentGain = null;
  let micWorkletUrl = null;
  let livePcmSamples = null;
  let playbackContext = null;
  let nextPlaybackTime = 0;
  let activePlaybackSources = [];
  let activeResponseText = '';
  let responseCompleteTimer = null;

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
      element.className = `component ${check.pass ? 'pass' : 'fail'}${check.optional ? ' optional' : ''}`;
      element.dataset.component = check.id;
      const suffix = check.optional ? ' <em>optional</em>' : '';
      element.innerHTML = `<div class="component-top"><span class="status-dot"></span><b>${escapeHtml(check.label)}</b></div><p>${escapeHtml(check.detail)}${suffix}</p>`;
      return element;
    }));
    // Core and optional are reported separately so a green core baseline is
    // never read as verification of the optional Rev B daughterboard.
    const core = snapshot.checks.filter((check) => !check.optional);
    const optional = snapshot.checks.filter((check) => check.optional);
    const corePassed = core.filter((check) => check.pass).length;
    const optionalPassed = optional.filter((check) => check.pass).length;
    byId('component-score').textContent =
      `${corePassed} / ${core.length} core · ${optionalPassed} / ${optional.length} optional`;
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
    const source = livePcmSamples && voiceSessionReady && snapshot.checks.find((check) => check.id === 'microphone').pass
      ? measurePcm(livePcmSamples)
      : emulator.generateMicrophoneSamples(480);
    const { samples, rms, peak } = source;
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

  async function pressPtt() {
    if (pttHeld || pttRequested) return;
    pttRequested = true;
    const voiceWasReady = voiceSessionReady;
    if (!voiceSessionReady) {
      const connected = await connectVoice({ requestMicrophone: true });
      if (!pttRequested) return;
      if (!connected) {
        pttRequested = false;
        setVoiceStatus('Voice unavailable', 'fail');
        return;
      }
    }
    if (!micStream && voiceWasReady) await enableMicrophone();
    if (micStream && !micProcessor) await startMicCapture().catch(() => false);
    if (!micStream || !micProcessor) {
      pttRequested = false;
      setVoiceStatus('Microphone unavailable · use text', 'fail');
      return;
    }
    pttRequested = false;
    pttHeld = true;
    flushVoicePlayback();
    if (voiceSocket?.readyState === WebSocket.OPEN) {
      voiceSocket.send(JSON.stringify({ type: 'response.cancel' }));
    }
    if (micContext?.state === 'suspended') void micContext.resume();
    emulator.pressPtt();
  }

  function releasePtt() {
    pttRequested = false;
    if (!pttHeld) return;
    pttHeld = false;
    if (voiceSessionReady && voiceSocket?.readyState === WebSocket.OPEN) {
      emulator.submitExternalVoiceInput();
      voiceSocket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      voiceSocket.send(JSON.stringify({ type: 'response.create' }));
      setVoiceStatus('Thinking', 'pending');
    } else {
      emulator.releasePtt();
    }
  }

  function setVoiceStatus(message, state = 'pending') {
    const status = byId('voice-status');
    status.textContent = message;
    status.className = state === 'pass' ? 'result-pass' : state === 'fail' ? 'result-fail' : 'result-pending';
  }

  function addVoiceTurn(role, text) {
    const value = String(text || '').trim();
    if (!value) return;
    byId('voice-empty')?.remove();
    const row = document.createElement('div');
    row.className = 'voice-turn';
    const roleElement = document.createElement('span');
    roleElement.className = 'voice-role';
    roleElement.textContent = role === 'user' ? 'You' : 'Morgan';
    const textElement = document.createElement('span');
    textElement.className = 'voice-text';
    textElement.textContent = value;
    row.append(roleElement, textElement);
    const transcript = byId('voice-transcript');
    transcript.appendChild(row);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function getMicrophoneWithTimeout(timeoutMs = 10000) {
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error('Microphone capture is not available in this browser.'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error('Microphone permission timed out.'));
      }, timeoutMs);
      navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }).then((stream) => {
        if (settled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function createMicWorkletUrl() {
    if (micWorkletUrl) return micWorkletUrl;
    const source = `
      class MorganBadgeMicProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this.buffer = new Float32Array(2048);
          this.offset = 0;
        }
        process(inputs) {
          const channel = inputs[0] && inputs[0][0];
          if (!channel) return true;
          for (let index = 0; index < channel.length; index += 1) {
            this.buffer[this.offset] = channel[index];
            this.offset += 1;
            if (this.offset >= this.buffer.length) {
              const packet = this.buffer;
              this.port.postMessage(packet, [packet.buffer]);
              this.buffer = new Float32Array(2048);
              this.offset = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('morgan-badge-mic', MorganBadgeMicProcessor);
    `;
    micWorkletUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    return micWorkletUrl;
  }

  function resampleToPcm16(float32, sourceRate, targetRate) {
    const ratio = sourceRate / targetRate;
    const length = Math.max(0, Math.floor(float32.length / ratio));
    const pcm16 = new Int16Array(length);
    for (let index = 0; index < length; index += 1) {
      const sourceIndex = index * ratio;
      const lower = Math.floor(sourceIndex);
      const fraction = sourceIndex - lower;
      const first = float32[lower] || 0;
      const sample = first + ((float32[lower + 1] || first) - first) * fraction;
      const clipped = Math.max(-1, Math.min(1, sample));
      pcm16[index] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    }
    return pcm16;
  }

  function measurePcm(samples) {
    let sumSquares = 0;
    let peak = 0;
    for (const sample of samples) {
      const normalized = sample / (sample < 0 ? 0x8000 : 0x7fff);
      sumSquares += normalized * normalized;
      peak = Math.max(peak, Math.abs(normalized));
    }
    return {
      samples,
      rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
      peak,
      clipped: peak >= 0.999,
    };
  }

  async function startMicCapture() {
    if (!micContext || !micStream || micProcessor) return Boolean(micProcessor);
    if (!micContext.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      setVoiceStatus('AudioWorklet unavailable · use text', 'fail');
      return false;
    }
    await micContext.audioWorklet.addModule(createMicWorkletUrl());
    micSource = micContext.createMediaStreamSource(micStream);
    micProcessor = new AudioWorkletNode(micContext, 'morgan-badge-mic', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    micSilentGain = micContext.createGain();
    micSilentGain.gain.value = 0;
    micSilentGain.connect(micContext.destination);
    micProcessor.port.onmessage = (event) => {
      const input = event.data instanceof Float32Array ? event.data : new Float32Array(event.data);
      const pcm16 = resampleToPcm16(input, micContext.sampleRate, 24000);
      livePcmSamples = pcm16;
      const measured = measurePcm(pcm16);
      emulator.microphone.lastRms = measured.rms;
      emulator.microphone.lastPeak = measured.peak;
      if (pttHeld && voiceSocket?.readyState === WebSocket.OPEN && pcm16.byteLength) {
        voiceSocket.send(pcm16.buffer);
      }
    };
    micSource.connect(micProcessor);
    micProcessor.connect(micSilentGain);
    return true;
  }

  async function enableMicrophone() {
    if (micStream) return true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setVoiceStatus('Web Audio is not available in this browser', 'fail');
      return false;
    }
    try {
      micStream = await getMicrophoneWithTimeout();
      micContext = new AudioContextClass();
      await micContext.resume();
      if (voiceSessionReady) await startMicCapture();
      return true;
    } catch (error) {
      micStream = null;
      micContext = null;
      setVoiceStatus(`${error instanceof Error ? error.message : 'Microphone unavailable'} · use text`, 'fail');
      return false;
    }
  }

  async function connectVoice(options = {}) {
    const requestMicrophone = options.requestMicrophone !== false;
    if (voiceSessionReady && voiceSocket?.readyState === WebSocket.OPEN) {
      if (!requestMicrophone || (micStream && micProcessor)) return true;
      const micReady = await enableMicrophone();
      byId('voice-connect').disabled = micReady;
      byId('voice-disconnect').disabled = false;
      if (micReady) setVoiceStatus('Connected · PTT ready', 'pass');
      return micReady;
    }
    if (voiceConnecting) return false;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setVoiceStatus('Web Audio is not available in this browser', 'fail');
      return false;
    }
    voiceConnecting = true;
    voiceIntentionalClose = false;
    setVoiceStatus(requestMicrophone ? 'Requesting microphone' : 'Connecting Morgan voice', 'pending');
    byId('voice-connect').disabled = true;
    let micError = null;
    if (requestMicrophone && !(await enableMicrophone())) micError = 'Microphone unavailable';
    if (!playbackContext) playbackContext = new AudioContextClass();
    if (playbackContext.state === 'suspended') await playbackContext.resume();

    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        voiceConnecting = false;
        resolve(value);
      };
      const timeout = setTimeout(() => {
        setVoiceStatus('Voice connection timed out', 'fail');
        try { voiceSocket?.close(); } catch { /* no-op */ }
        settle(false);
      }, 20000);
      try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        voiceSocket = new WebSocket(`${protocol}//${location.host}/api/badge-emulator/voice`);
        voiceSocket.binaryType = 'arraybuffer';
        voiceSocket.onopen = () => setVoiceStatus('Voice socket connected', 'pending');
        voiceSocket.onmessage = async (event) => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          await handleVoiceEvent(message);
          if (message.type === 'session.updated') settle(true);
        };
        voiceSocket.onerror = () => setVoiceStatus('Voice connection error', 'fail');
        voiceSocket.onclose = (event) => {
          voiceSessionReady = false;
          byId('voice-connect').disabled = false;
          byId('voice-disconnect').disabled = true;
          emulator.disconnectExternalVoice();
          if (!voiceIntentionalClose) setVoiceStatus(event.reason || 'Voice disconnected', 'fail');
          settle(false);
          cleanupVoiceMedia();
        };
      } catch (error) {
        setVoiceStatus(error instanceof Error ? error.message : 'Voice connection failed', 'fail');
        settle(false);
      }
      if (micError) setVoiceStatus(`${micError} · text remains available`, 'pending');
    });
  }

  async function handleVoiceEvent(event) {
    switch (event.type) {
      case 'session.created':
        setVoiceStatus('Voice session created', 'pending');
        break;
      case 'session.updated': {
        voiceSessionReady = true;
        const micReady = await startMicCapture().catch(() => false);
        byId('voice-connect').disabled = micReady;
        byId('voice-disconnect').disabled = false;
        setVoiceStatus(micReady ? 'Connected · PTT ready' : 'Connected · text only', 'pass');
        emulator.log('VOICE', 'Browser Voice Live session ready', 'ok');
        emulator.emit();
        break;
      }
      case 'input_audio_buffer.speech_started':
        setVoiceStatus('Listening', 'pass');
        break;
      case 'input_audio_buffer.speech_stopped':
        setVoiceStatus('Thinking', 'pending');
        break;
      case 'conversation.item.input_audio_transcription.completed':
        addVoiceTurn('user', event.transcript || '');
        break;
      case 'response.created':
        activeResponseText = '';
        emulator.beginExternalResponse();
        setVoiceStatus('Morgan speaking', 'pass');
        break;
      case 'response.audio.delta':
        if (event.delta) queueVoiceAudio(event.delta);
        if (latestSnapshot.state !== STATES.SPEAKING) emulator.beginExternalResponse();
        break;
      case 'response.audio_transcript.delta':
        if (event.delta) activeResponseText += event.delta;
        break;
      case 'response.audio_transcript.done':
        addVoiceTurn('assistant', event.transcript || activeResponseText);
        activeResponseText = '';
        break;
      case 'response.output_text.done':
      case 'response.text.done':
        addVoiceTurn('assistant', event.text || '');
        break;
      case 'response.done':
        finishResponseAfterPlayback();
        break;
      case 'error':
        if (!String(event.error?.message || '').includes('no active response')) {
          setVoiceStatus(event.error?.message || 'Voice error', 'fail');
          emulator.log('VOICE', event.error?.message || 'Voice error', 'error');
          emulator.emit();
        }
        break;
      default:
        break;
    }
  }

  function queueVoiceAudio(base64) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!playbackContext && AudioContextClass) playbackContext = new AudioContextClass();
    if (!playbackContext) return;
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    const int16 = new Int16Array(bytes.buffer);
    const floatData = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index += 1) {
      floatData[index] = int16[index] / (int16[index] < 0 ? 0x8000 : 0x7fff);
    }
    const buffer = playbackContext.createBuffer(1, floatData.length, 24000);
    buffer.copyToChannel(floatData, 0);
    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);
    const startTime = Math.max(playbackContext.currentTime, nextPlaybackTime);
    source.start(startTime);
    nextPlaybackTime = startTime + buffer.duration;
    activePlaybackSources.push(source);
    source.onended = () => { activePlaybackSources = activePlaybackSources.filter((item) => item !== source); };
  }

  function flushVoicePlayback() {
    clearTimeout(responseCompleteTimer);
    responseCompleteTimer = null;
    for (const source of activePlaybackSources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    activePlaybackSources = [];
    nextPlaybackTime = 0;
  }

  function finishResponseAfterPlayback() {
    const remainingMs = playbackContext
      ? Math.max(0, (nextPlaybackTime - playbackContext.currentTime) * 1000)
      : 0;
    clearTimeout(responseCompleteTimer);
    responseCompleteTimer = setTimeout(() => {
      emulator.completeExternalResponse();
      setVoiceStatus(micStream && micProcessor ? 'Connected · PTT ready' : 'Connected · text only', 'pass');
    }, remainingMs + 80);
  }

  async function sendVoiceText(text) {
    const prompt = String(text || '').trim();
    if (!prompt) return;
    addVoiceTurn('user', prompt);
    emulator.enterState(STATES.THINKING, 'Morgan is thinking');
    if (!(await connectVoice({ requestMicrophone: false })) || voiceSocket?.readyState !== WebSocket.OPEN) {
      await runTextSpeechFallback(prompt);
      return;
    }
    voiceSocket.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] },
    }));
    voiceSocket.send(JSON.stringify({ type: 'response.create' }));
    setVoiceStatus('Thinking', 'pending');
  }

  async function runTextSpeechFallback(prompt) {
    setVoiceStatus('Text fallback', 'pending');
    try {
      const response = await fetch('/responses', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: prompt, metadata: { scenario: 'badge-emulator-voice-fallback' } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const reply = String(payload.output_text || 'Morgan completed the turn without text output.');
      addVoiceTurn('assistant', reply);
      speakBrowserFallback(reply);
    } catch (error) {
      setVoiceStatus(error instanceof Error ? error.message : 'Text fallback failed', 'fail');
      emulator.completeExternalResponse();
    }
  }

  function speakBrowserFallback(text) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
      setVoiceStatus('Text reply only', 'pending');
      emulator.completeExternalResponse();
      return;
    }
    const spoken = String(text).replace(/[*_#`|]/g, ' ').replace(/\s+/g, ' ').slice(0, 2500);
    const utterance = new SpeechSynthesisUtterance(spoken);
    const preferred = speechSynthesis.getVoices().find((voice) => /Ava|Sonia|Jenny|female/i.test(voice.name));
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.98;
    utterance.volume = 0.9;
    utterance.onstart = () => {
      emulator.beginExternalResponse('Morgan is speaking · browser fallback');
      setVoiceStatus('Morgan speaking · browser fallback', 'pass');
    };
    utterance.onend = () => {
      emulator.completeExternalResponse();
      setVoiceStatus('Text fallback ready', 'pass');
    };
    utterance.onerror = () => {
      emulator.completeExternalResponse();
      setVoiceStatus('Browser speech failed', 'fail');
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  function disconnectVoice() {
    voiceIntentionalClose = true;
    pttHeld = false;
    pttRequested = false;
    if (voiceSocket && voiceSocket.readyState < WebSocket.CLOSING) voiceSocket.close(1000, 'User disconnected');
    voiceSessionReady = false;
    byId('voice-connect').disabled = false;
    byId('voice-disconnect').disabled = true;
    cleanupVoiceMedia();
    emulator.disconnectExternalVoice();
    setVoiceStatus('Disconnected', 'pending');
  }

  function cleanupVoiceMedia() {
    if (micProcessor) {
      try { micProcessor.port.onmessage = null; micProcessor.disconnect(); } catch { /* no-op */ }
      micProcessor = null;
    }
    if (micSource) { try { micSource.disconnect(); } catch { /* no-op */ } micSource = null; }
    if (micSilentGain) { try { micSilentGain.disconnect(); } catch { /* no-op */ } micSilentGain = null; }
    if (micStream) { micStream.getTracks().forEach((track) => track.stop()); micStream = null; }
    if (micContext) { void micContext.close().catch(() => {}); micContext = null; }
    livePcmSamples = null;
    flushVoicePlayback();
    if (playbackContext) { void playbackContext.close().catch(() => {}); playbackContext = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
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
      disconnectVoice();
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
    byId('voice-connect').addEventListener('click', () => { void connectVoice({ requestMicrophone: true }); });
    byId('voice-disconnect').addEventListener('click', disconnectVoice);
    byId('voice-text-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const input = byId('voice-text-input');
      const prompt = input.value.trim();
      if (!prompt) return;
      input.value = '';
      void sendVoiceText(prompt);
    });
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
  window.__badgeEmulatorUi = {
    runValidation,
    runFaultMatrix,
    pressPtt,
    releasePtt,
    connectVoice,
    disconnectVoice,
    sendVoiceText,
    getLastTestResult: () => lastTestResult,
    getVoiceState: () => ({
      connecting: voiceConnecting,
      ready: voiceSessionReady,
      socketState: voiceSocket?.readyState ?? WebSocket.CLOSED,
      microphone: Boolean(micStream && micProcessor),
      playbackQueued: activePlaybackSources.length,
    }),
  };
})();
