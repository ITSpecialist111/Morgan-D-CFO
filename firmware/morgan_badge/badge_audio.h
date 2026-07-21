#pragma once

#include <Arduino.h>
#include <ESP_I2S.h>

class BadgeAudio {
 public:
  bool begin();
  size_t readMicrophone(int16_t* samples, size_t sampleCapacity);
  void playConfirmationTone();
  void playPcm16(const int16_t* samples, size_t sampleCount);
  void stopPlayback();
  void setAmplifierEnabled(bool enabled);
  bool ready() const;

 private:
  I2SClass i2s_;
  bool ready_ = false;
};
