#include "badge_peripherals.h"

#include <Wire.h>

#include <cmath>
#include <cstring>

#include "board_config.h"

namespace {
// MPU6050 registers.
constexpr uint8_t kImuPowerMgmt1 = 0x6B;
constexpr uint8_t kImuWhoAmI = 0x75;
constexpr uint8_t kImuAccelXOutH = 0x3B;
constexpr float kAccelCountsPerG = 16384.0F;  // +/-2g default full scale.

// DRV2605L registers.
constexpr uint8_t kHapticMode = 0x01;
constexpr uint8_t kHapticLibrary = 0x03;
constexpr uint8_t kHapticWaveform0 = 0x04;
constexpr uint8_t kHapticGo = 0x0C;

struct HapticPattern {
  const char* name;
  uint8_t effect;
  uint16_t durationMs;
};

constexpr HapticPattern kHapticPatterns[] = {
    {"click", 1, 40},
    {"ramp", 82, 260},
    {"alert", 27, 520},
};
}  // namespace

void BadgePeripherals::begin(BadgeHal* hal) {
  hal_ = hal;
  std::strncpy(lastHapticPattern_, "none", sizeof(lastHapticPattern_) - 1);

  if (hal_ == nullptr) return;

  // Only try to configure the IMU when a device actually acknowledged.
  if (hal_->mode(Peripheral::Imu) == PeripheralMode::Real) {
    uint8_t who = 0;
    if (readRegisters(BadgeConfig::kImuAddress, kImuWhoAmI, &who, 1) &&
        (who == 0x68 || who == 0x69)) {
      // Clear sleep so the accelerometer produces data.
      imuReady_ = writeRegister(BadgeConfig::kImuAddress, kImuPowerMgmt1, 0x00);
      char detail[56];
      snprintf(detail, sizeof(detail), "i2c ack, WHO_AM_I 0x%02X", who);
      hal_->setReal(Peripheral::Imu, detail);
    } else {
      hal_->setAbsent(Peripheral::Imu, "i2c ack but WHO_AM_I mismatch");
    }
  }

  if (hal_->mode(Peripheral::Haptic) == PeripheralMode::Real) {
    // Internal trigger mode with the standard immersion library.
    writeRegister(BadgeConfig::kHapticAddress, kHapticMode, 0x00);
    writeRegister(BadgeConfig::kHapticAddress, kHapticLibrary, 0x01);
  }
}

bool BadgePeripherals::writeRegister(uint8_t address, uint8_t reg, uint8_t value) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool BadgePeripherals::readRegisters(uint8_t address, uint8_t reg,
                                     uint8_t* buffer, size_t length) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  const size_t received = Wire.requestFrom(address, static_cast<uint8_t>(length));
  if (received != length) return false;
  for (size_t index = 0; index < length; ++index) {
    buffer[index] = Wire.read();
  }
  return true;
}

void BadgePeripherals::simulateTilt(float pitchDegrees, float rollDegrees) {
  simulatedPitch_ = pitchDegrees;
  simulatedRoll_ = rollDegrees;
}

TiltReading BadgePeripherals::readTilt() {
  TiltReading reading;
  if (hal_ == nullptr) return reading;

  const PeripheralMode mode = hal_->mode(Peripheral::Imu);
  if (mode == PeripheralMode::Real && imuReady_) {
    uint8_t raw[6] = {};
    if (!readRegisters(BadgeConfig::kImuAddress, kImuAccelXOutH, raw, sizeof(raw))) {
      return reading;
    }
    const int16_t accelX = static_cast<int16_t>((raw[0] << 8) | raw[1]);
    const int16_t accelY = static_cast<int16_t>((raw[2] << 8) | raw[3]);
    const int16_t accelZ = static_cast<int16_t>((raw[4] << 8) | raw[5]);
    const float x = accelX / kAccelCountsPerG;
    const float y = accelY / kAccelCountsPerG;
    const float z = accelZ / kAccelCountsPerG;
    reading.pitchDegrees = atan2f(-x, sqrtf(y * y + z * z)) * 180.0F / PI;
    reading.rollDegrees = atan2f(y, z) * 180.0F / PI;
    reading.valid = true;
  } else if (mode == PeripheralMode::Simulated) {
    reading.pitchDegrees = simulatedPitch_;
    reading.rollDegrees = simulatedRoll_;
    reading.valid = true;
  } else {
    return reading;  // Absent: no data, and explicitly not valid.
  }

  reading.motionInterrupt =
      fabsf(reading.pitchDegrees) >= kMotionInterruptDegrees ||
      fabsf(reading.rollDegrees) >= kMotionInterruptDegrees;
  return reading;
}

bool BadgePeripherals::playHaptic(const char* pattern) {
  if (hal_ == nullptr || pattern == nullptr) return false;

  const HapticPattern* selected = nullptr;
  for (const HapticPattern& candidate : kHapticPatterns) {
    if (strcmp(candidate.name, pattern) == 0) {
      selected = &candidate;
      break;
    }
  }
  if (selected == nullptr) return false;

  const PeripheralMode mode = hal_->mode(Peripheral::Haptic);
  if (mode == PeripheralMode::Absent) return false;

  std::strncpy(lastHapticPattern_, selected->name, sizeof(lastHapticPattern_) - 1);
  lastHapticPattern_[sizeof(lastHapticPattern_) - 1] = '\0';
  lastHapticDurationMs_ = selected->durationMs;

  if (mode == PeripheralMode::Real) {
    if (!writeRegister(BadgeConfig::kHapticAddress, kHapticWaveform0,
                       selected->effect)) {
      return false;
    }
    return writeRegister(BadgeConfig::kHapticAddress, kHapticGo, 0x01);
  }
  return true;  // Simulated: pattern and duration recorded for assertions.
}

void BadgePeripherals::simulateNfcTap(bool authorized) {
  simulatedTapPending_ = true;
  simulatedTapAuthorized_ = authorized;
}

bool BadgePeripherals::nfcFirmwareVersion(uint32_t* versionOut) {
  if (hal_ == nullptr || versionOut == nullptr) return false;
  if (hal_->mode(Peripheral::Nfc) != PeripheralMode::Real) return false;

  // PN532 GetFirmwareVersion (0x02) wrapped in the standard information frame.
  static const uint8_t kFrame[] = {0x00, 0x00, 0xFF, 0x02, 0xFE,
                                   0xD4, 0x02, 0x2A, 0x00};
  Wire.beginTransmission(BadgeConfig::kNfcAddress);
  Wire.write(kFrame, sizeof(kFrame));
  if (Wire.endTransmission() != 0) return false;

  delay(20);
  // Status byte, then the 6-byte ACK frame, then the response frame. Validate
  // the framing before trusting any of it: a bare 0x01 status byte with no
  // frame behind it must not be reported as a working module.
  uint8_t response[32] = {};
  const size_t received =
      Wire.requestFrom(BadgeConfig::kNfcAddress, static_cast<uint8_t>(sizeof(response)));
  if (received < 20) return false;
  for (size_t index = 0; index < received && index < sizeof(response); ++index) {
    response[index] = Wire.read();
  }
  if ((response[0] & 0x01) == 0) return false;  // Not ready.

  // Expected: status, ACK (00 00 FF 00 FF 00), then 00 00 FF LEN LCS D5 03 ...
  static const uint8_t kAck[] = {0x00, 0x00, 0xFF, 0x00, 0xFF, 0x00};
  if (memcmp(response + 1, kAck, sizeof(kAck)) != 0) return false;

  const uint8_t* frame = response + 1 + sizeof(kAck);
  if (frame[0] != 0x00 || frame[1] != 0x00 || frame[2] != 0xFF) return false;
  const uint8_t length = frame[3];
  const uint8_t lengthChecksum = frame[4];
  if (static_cast<uint8_t>(length + lengthChecksum) != 0) return false;
  // TFI 0xD5 with command code 0x03 is the GetFirmwareVersion response.
  if (frame[5] != 0xD5 || frame[6] != 0x03) return false;

  *versionOut = (static_cast<uint32_t>(frame[7]) << 24) |
                (static_cast<uint32_t>(frame[8]) << 16) |
                (static_cast<uint32_t>(frame[9]) << 8) |
                static_cast<uint32_t>(frame[10]);
  return true;
}

NfcTap BadgePeripherals::pollNfc() {
  NfcTap tap;
  if (hal_ == nullptr) return tap;

  const PeripheralMode mode = hal_->mode(Peripheral::Nfc);
  if (mode == PeripheralMode::Simulated) {
    if (!simulatedTapPending_) return tap;
    simulatedTapPending_ = false;
    tap.present = true;
    tap.authorized = simulatedTapAuthorized_;
    std::strncpy(tap.uid, simulatedTapAuthorized_ ? "SIM-AUTHORIZED" : "SIM-DENIED",
                 sizeof(tap.uid) - 1);
    return tap;
  }

  // Real passive-target polling is not implemented yet. Returning "not present"
  // is deliberate: a half-written driver must not report a tap it cannot read.
  return tap;
}
