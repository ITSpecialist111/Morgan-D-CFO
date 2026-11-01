#pragma once

#include <Arduino.h>
#include <ESP_I2S.h>

#include "badge_hal.h"

struct AudioCaptureStats {
  size_t framesRead = 0;
  uint32_t elapsedMicros = 0;
  float rms = 0.0F;
  float peak = 0.0F;
  uint32_t clippedSamples = 0;
  bool synthetic = false;
  // Statistics of the raw 24-bit I2S words, before any synthetic substitution.
  // A fitted microphone always dithers around its noise floor; an unconnected
  // data line produces a constant word. This is what separates a soldered
  // ICS-43434 from a bare pad.
  int32_t rawMin = 0;
  int32_t rawMax = 0;
  uint32_t rawSpread = 0;
};

class BadgeAudio {
 public:
  bool begin(BadgeHal* hal);

  // Always drives the real I2S RX path so the peripheral is exercised on
  // silicon. When the microphone is in Simulated mode the returned sample
  // values are replaced with a deterministic tone, and
  // lastCaptureWasSynthetic() records that so no caller can mistake the result
  // for a genuine acoustic measurement.
  size_t readMicrophone(int16_t* samples, size_t sampleCapacity);
  bool lastCaptureWasSynthetic() const { return lastCaptureSynthetic_; }

  void playConfirmationTone();
  void playPcm16(const int16_t* samples, size_t sampleCount);
  void stopPlayback();
  void setAmplifierEnabled(bool enabled);
  bool ready() const;

  // Mutes the amplifier once the DMA queue has had time to drain after the last
  // write. Call from loop(): streamed playback writes chunk after chunk, so no
  // single call site knows when audio has finished.
  void serviceAmplifier(uint32_t nowMs);

  // Deterministic stimulus used by the self-test and by Simulated capture.
  void setSyntheticTone(float frequencyHz, float amplitude);

  // Captures a block and reports timing plus level, so the self-test can assert
  // the I2S frame rate rather than only the sample values.
  AudioCaptureStats measureCapture(size_t frames);

  uint32_t clippedSampleCount() const { return clippedSamples_; }
  bool amplifierEnabled() const { return amplifierEnabled_; }

  // Minimum spread, in 24-bit LSBs, that a real microphone must show across a
  // capture before it is treated as present.
  static constexpr uint32_t kMicrophonePresenceSpread = 64;

 private:
  I2SClass i2s_;
  BadgeHal* hal_ = nullptr;
  bool ready_ = false;
  bool amplifierEnabled_ = false;
  bool lastCaptureSynthetic_ = false;
  uint32_t clippedSamples_ = 0;
  uint32_t lastPlaybackMs_ = 0;
  int32_t rawMin_ = 0;
  int32_t rawMax_ = 0;
  bool rawStatsValid_ = false;
  float syntheticFrequencyHz_ = 440.0F;
  float syntheticAmplitude_ = 0.25F;
  uint32_t syntheticPhase_ = 0;

  void fillSynthetic(int16_t* samples, size_t count);
};
