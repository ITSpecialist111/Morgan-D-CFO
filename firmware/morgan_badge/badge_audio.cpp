#include "badge_audio.h"

#include <algorithm>
#include <cmath>

#include "board_config.h"

namespace {
constexpr size_t kFramesPerChunk = 240;
constexpr float kToneFrequencyHz = 523.25F;
constexpr float kToneAmplitude = 0.16F;
constexpr uint32_t kToneDurationMs = 180;

// The ESP32-C5 has no hardware FPU, so calling sinf() per sample is far too
// slow to keep up with a 24 kHz stream and skews any timing measurement. A
// small quarter-scale table plus a fixed-point phase accumulator makes
// synthetic capture effectively free.
constexpr size_t kSineTableSize = 256;
int16_t gSineTable[kSineTableSize];
bool gSineTableReady = false;

void ensureSineTable() {
  if (gSineTableReady) return;
  for (size_t index = 0; index < kSineTableSize; ++index) {
    const float phase = 2.0F * PI * static_cast<float>(index) /
                        static_cast<float>(kSineTableSize);
    gSineTable[index] = static_cast<int16_t>(std::sin(phase) * 32767.0F);
  }
  gSineTableReady = true;
}

// Full-scale range of the ICS-43434's 24-bit output word.
constexpr int32_t kMic24BitMax = 8388607;
constexpr int32_t kMic24BitMin = -8388608;
}  // namespace

bool BadgeAudio::begin(BadgeHal* hal) {
  hal_ = hal;

  pinMode(BadgeConfig::kAmplifierSdPin, OUTPUT);
  setAmplifierEnabled(false);

  i2s_.setPins(BadgeConfig::kI2sBitClockPin,
               BadgeConfig::kI2sWordSelectPin,
               BadgeConfig::kAmplifierDataPin,
               BadgeConfig::kMicrophoneDataPin);
  ready_ = i2s_.begin(I2S_MODE_STD,
                      BadgeConfig::kAudioSampleRate,
                      I2S_DATA_BIT_WIDTH_32BIT,
                      I2S_SLOT_MODE_STEREO);
  return ready_;
}

void BadgeAudio::setSyntheticTone(float frequencyHz, float amplitude) {
  ensureSineTable();
  syntheticFrequencyHz_ = frequencyHz;
  syntheticAmplitude_ = std::min(1.0F, std::max(0.0F, amplitude));
  syntheticPhase_ = 0;
}

void BadgeAudio::fillSynthetic(int16_t* samples, size_t count) {
  ensureSineTable();
  // 32-bit phase accumulator; the top 8 bits index the table.
  const uint32_t increment = static_cast<uint32_t>(
      (static_cast<double>(syntheticFrequencyHz_) /
       static_cast<double>(BadgeConfig::kAudioSampleRate)) * 4294967296.0);
  const int32_t amplitudeQ15 =
      static_cast<int32_t>(syntheticAmplitude_ * 32767.0F);
  for (size_t index = 0; index < count; ++index) {
    const uint8_t tableIndex = static_cast<uint8_t>(syntheticPhase_ >> 24);
    samples[index] = static_cast<int16_t>(
        (static_cast<int32_t>(gSineTable[tableIndex]) * amplitudeQ15) >> 15);
    syntheticPhase_ += increment;
  }
}

size_t BadgeAudio::readMicrophone(int16_t* samples, size_t sampleCapacity) {
  lastCaptureSynthetic_ = false;
  if (!ready_ || samples == nullptr || sampleCapacity == 0) return 0;

  static int32_t stereoFrames[kFramesPerChunk * 2];
  const size_t frameCapacity = std::min(sampleCapacity, kFramesPerChunk);
  const size_t bytesRead = i2s_.readBytes(
      reinterpret_cast<char*>(stereoFrames),
      frameCapacity * 2 * sizeof(int32_t));
  const size_t framesRead = bytesRead / (2 * sizeof(int32_t));

  for (size_t frame = 0; frame < framesRead; ++frame) {
    // ICS-43434 L/R is strapped low in the schematic, selecting the left slot.
    // The part presents 24-bit data MSB-aligned in a 32-bit slot, so bits 31..8
    // carry the sample and a shift of 16 is the unity-gain 16-bit extraction.
    const int32_t raw = stereoFrames[frame * 2];
    // Clipping has to be detected on the 24-bit source value. After the shift
    // the result always fits in an int16_t, so a post-shift range test could
    // never fire and would be a tautology.
    const int32_t sample24 = raw >> 8;
    if (sample24 >= kMic24BitMax || sample24 <= kMic24BitMin) {
      ++clippedSamples_;
    }
    // Track the raw word range. This is measured before any synthetic
    // substitution, so it always describes the physical data line.
    if (!rawStatsValid_) {
      rawMin_ = sample24;
      rawMax_ = sample24;
      rawStatsValid_ = true;
    } else {
      if (sample24 < rawMin_) rawMin_ = sample24;
      if (sample24 > rawMax_) rawMax_ = sample24;
    }
    samples[frame] =
        static_cast<int16_t>(raw >> BadgeConfig::kMicrophoneShift);
  }

  // The I2S peripheral above was still exercised on real silicon; only the
  // sample values are replaced when no microphone is fitted.
  if (hal_ != nullptr &&
      hal_->mode(Peripheral::Microphone) == PeripheralMode::Simulated &&
      framesRead > 0) {
    fillSynthetic(samples, framesRead);
    lastCaptureSynthetic_ = true;
  }
  return framesRead;
}

AudioCaptureStats BadgeAudio::measureCapture(size_t frames) {
  AudioCaptureStats stats;
  if (!ready_) return stats;

  static int16_t block[kFramesPerChunk];

  // The DMA ring holds frames captured while nothing was reading, so the first
  // read returns instantly and would measure the backlog rather than the clock.
  // Drain first, then time a sustained capture: that is what actually proves
  // the I2S peripheral is clocking at the configured sample rate.
  // Draining uses an elapsed-time comparison so the loop is immune to the
  // millis() rollover at ~49.7 days.
  const uint32_t drainStartedMs = millis();
  while (millis() - drainStartedMs < 60) {
    readMicrophone(block, kFramesPerChunk);
  }

  // Clipping and raw range are reported per capture, so start from a clean slate.
  clippedSamples_ = 0;
  rawStatsValid_ = false;
  rawMin_ = 0;
  rawMax_ = 0;
  size_t collected = 0;
  const uint32_t startedMicros = micros();
  while (collected < frames) {
    const size_t want = std::min(kFramesPerChunk, frames - collected);
    const size_t got = readMicrophone(block, want);
    if (got == 0) break;
    collected += got;
  }
  stats.elapsedMicros = micros() - startedMicros;
  stats.framesRead = collected;
  stats.synthetic = lastCaptureSynthetic_;
  stats.clippedSamples = clippedSamples_;
  stats.rawMin = rawMin_;
  stats.rawMax = rawMax_;
  stats.rawSpread = rawStatsValid_
                        ? static_cast<uint32_t>(rawMax_ - rawMin_)
                        : 0;

  float sumSquares = 0.0F;
  const size_t analysed = std::min(collected, kFramesPerChunk);
  for (size_t index = 0; index < analysed; ++index) {
    const float normalized = static_cast<float>(block[index]) / 32768.0F;
    sumSquares += normalized * normalized;
    stats.peak = std::max(stats.peak, fabsf(normalized));
  }
  if (analysed > 0) {
    stats.rms = sqrtf(sumSquares / static_cast<float>(analysed));
  }
  return stats;
}

void BadgeAudio::playConfirmationTone() {
  if (!ready_) return;
  ensureSineTable();

  setAmplifierEnabled(true);
  static int32_t stereoFrames[kFramesPerChunk * 2];
  const size_t totalSamples =
      BadgeConfig::kAudioSampleRate * kToneDurationMs / 1000;
  // The table lookup replaces a per-sample sinf(); the C5 has no FPU, so the
  // float version blocked the main loop for roughly the tone's own duration.
  const uint32_t increment = static_cast<uint32_t>(
      (static_cast<double>(kToneFrequencyHz) /
       static_cast<double>(BadgeConfig::kAudioSampleRate)) * 4294967296.0);
  const int32_t amplitudeQ15 = static_cast<int32_t>(kToneAmplitude * 32767.0F);
  uint32_t phase = 0;

  for (size_t offset = 0; offset < totalSamples; offset += kFramesPerChunk) {
    const size_t samplesThisChunk =
        std::min(kFramesPerChunk, totalSamples - offset);
    for (size_t index = 0; index < samplesThisChunk; ++index) {
      const uint8_t tableIndex = static_cast<uint8_t>(phase >> 24);
      const int16_t pcmSample = static_cast<int16_t>(
          (static_cast<int32_t>(gSineTable[tableIndex]) * amplitudeQ15) >> 15);
      phase += increment;
      const int32_t i2sSample = static_cast<int32_t>(pcmSample) << 16;
      stereoFrames[index * 2] = i2sSample;
      stereoFrames[index * 2 + 1] = i2sSample;
    }
    i2s_.write(reinterpret_cast<const uint8_t*>(stereoFrames),
               samplesThisChunk * 2 * sizeof(int32_t));
  }

  lastPlaybackMs_ = millis();
  stopPlayback();
}

void BadgeAudio::playPcm16(const int16_t* samples, size_t sampleCount) {
  if (!ready_ || !samples || sampleCount == 0) return;

  setAmplifierEnabled(true);
  static int32_t stereoFrames[kFramesPerChunk * 2];
  for (size_t offset = 0; offset < sampleCount; offset += kFramesPerChunk) {
    const size_t samplesThisChunk =
        std::min(kFramesPerChunk, sampleCount - offset);
    for (size_t index = 0; index < samplesThisChunk; ++index) {
      const int32_t i2sSample =
          static_cast<int32_t>(samples[offset + index]) << 16;
      stereoFrames[index * 2] = i2sSample;
      stereoFrames[index * 2 + 1] = i2sSample;
    }
    i2s_.write(reinterpret_cast<const uint8_t*>(stereoFrames),
               samplesThisChunk * 2 * sizeof(int32_t));
  }
  // Streamed playback arrives chunk by chunk, so the amplifier is muted by
  // serviceAmplifier() once writes stop rather than after every chunk.
  lastPlaybackMs_ = millis();
}

void BadgeAudio::serviceAmplifier(uint32_t nowMs) {
  if (!amplifierEnabled_) return;
  if (nowMs - lastPlaybackMs_ < BadgeConfig::kAmplifierDrainMs) return;
  setAmplifierEnabled(false);
}

void BadgeAudio::stopPlayback() {
  if (!amplifierEnabled_) return;
  // i2s_.write() returns once the data is queued, not once it has been clocked
  // out. Muting immediately truncates the tail and clicks, so let the DMA
  // queue drain first.
  delay(BadgeConfig::kAmplifierDrainMs);
  setAmplifierEnabled(false);
}

void BadgeAudio::setAmplifierEnabled(bool enabled) {
  amplifierEnabled_ = enabled;
  digitalWrite(BadgeConfig::kAmplifierSdPin, enabled ? HIGH : LOW);
}

bool BadgeAudio::ready() const {
  return ready_;
}
