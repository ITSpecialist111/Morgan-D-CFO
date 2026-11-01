#pragma once

#include <Arduino.h>

#include "badge_hal.h"

struct TiltReading {
  float pitchDegrees = 0.0F;
  float rollDegrees = 0.0F;
  bool motionInterrupt = false;
  bool valid = false;
};

struct NfcTap {
  bool present = false;
  bool authorized = false;
  char uid[24] = {};
};

// Optional Rev B peripherals on the rear-pad I2C bus.
//
// Each call routes through BadgeHal, so behaviour is identical whether the part
// is soldered (Real) or being exercised on the bench (Simulated). Nothing here
// invents a Real verdict: that only comes from a device acknowledging on I2C.
class BadgePeripherals {
 public:
  void begin(BadgeHal* hal);

  // Motion. Real path reads the MPU6050 accelerometer; simulated path replays
  // the scripted tilt set by simulateTilt().
  TiltReading readTilt();
  void simulateTilt(float pitchDegrees, float rollDegrees);

  // Haptics. Real path triggers a DRV2605L waveform; simulated path records the
  // effect and duration so timing can still be asserted.
  bool playHaptic(const char* pattern);
  const char* lastHapticPattern() const { return lastHapticPattern_; }
  uint16_t lastHapticDurationMs() const { return lastHapticDurationMs_; }

  // NFC. Real path queries the PN532 firmware version to confirm the module
  // responds; tag polling is not implemented on hardware yet and reports so.
  bool nfcFirmwareVersion(uint32_t* versionOut);
  NfcTap pollNfc();
  void simulateNfcTap(bool authorized);

  static constexpr float kMotionInterruptDegrees = 35.0F;

 private:
  BadgeHal* hal_ = nullptr;
  float simulatedPitch_ = 0.0F;
  float simulatedRoll_ = 0.0F;
  bool simulatedTapPending_ = false;
  bool simulatedTapAuthorized_ = false;
  char lastHapticPattern_[16] = {};
  uint16_t lastHapticDurationMs_ = 0;

  bool imuReady_ = false;

  bool writeRegister(uint8_t address, uint8_t reg, uint8_t value);
  bool readRegisters(uint8_t address, uint8_t reg, uint8_t* buffer, size_t length);
};
