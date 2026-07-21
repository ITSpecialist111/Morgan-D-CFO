#include "badge_audio.h"

#include <algorithm>
#include <cmath>

#include "board_config.h"

namespace {
constexpr size_t kFramesPerChunk = 240;
constexpr float kToneFrequencyHz = 523.25F;
constexpr float kToneAmplitude = 0.16F;
constexpr uint32_t kToneDurationMs = 180;
}  // namespace

bool BadgeAudio::begin() {
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

size_t BadgeAudio::readMicrophone(int16_t* samples, size_t sampleCapacity) {
  if (!ready_ || samples == nullptr || sampleCapacity == 0) return 0;

  static int32_t stereoFrames[kFramesPerChunk * 2];
  const size_t frameCapacity = std::min(sampleCapacity, kFramesPerChunk);
  const size_t bytesRead = i2s_.readBytes(
      reinterpret_cast<char*>(stereoFrames),
      frameCapacity * 2 * sizeof(int32_t));
  const size_t framesRead = bytesRead / (2 * sizeof(int32_t));

  for (size_t frame = 0; frame < framesRead; ++frame) {
    // ICS-43434 L/R is strapped low in the schematic, selecting the left slot.
    const int32_t microphoneSample = stereoFrames[frame * 2];
    samples[frame] = static_cast<int16_t>(
        std::clamp(microphoneSample >> 14, -32768L, 32767L));
  }
  return framesRead;
}

void BadgeAudio::playConfirmationTone() {
  if (!ready_) return;

  setAmplifierEnabled(true);
  static int32_t stereoFrames[kFramesPerChunk * 2];
  const size_t totalSamples =
      BadgeConfig::kAudioSampleRate * kToneDurationMs / 1000;

  for (size_t offset = 0; offset < totalSamples; offset += kFramesPerChunk) {
    const size_t samplesThisChunk =
        std::min(kFramesPerChunk, totalSamples - offset);
    for (size_t index = 0; index < samplesThisChunk; ++index) {
      const float phase = 2.0F * PI * kToneFrequencyHz *
                          static_cast<float>(offset + index) /
                          static_cast<float>(BadgeConfig::kAudioSampleRate);
      const int16_t pcmSample = static_cast<int16_t>(
          std::sin(phase) * kToneAmplitude * 32767.0F);
      const int32_t i2sSample = static_cast<int32_t>(pcmSample) << 16;
      stereoFrames[index * 2] = i2sSample;
      stereoFrames[index * 2 + 1] = i2sSample;
    }
    i2s_.write(reinterpret_cast<const uint8_t*>(stereoFrames),
               samplesThisChunk * 2 * sizeof(int32_t));
  }

  setAmplifierEnabled(false);
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
}

void BadgeAudio::stopPlayback() {
  setAmplifierEnabled(false);
}

void BadgeAudio::setAmplifierEnabled(bool enabled) {
  digitalWrite(BadgeConfig::kAmplifierSdPin, enabled ? HIGH : LOW);
}

bool BadgeAudio::ready() const {
  return ready_;
}
