#pragma once

#include <Arduino.h>

// Compile-time switch. A release build can define this to 0 so the simulated
// backends are not linked at all and a shipped badge cannot report SIM-PASS.
#ifndef BADGE_ALLOW_SIMULATION
#define BADGE_ALLOW_SIMULATION 1
#endif

enum class Peripheral : uint8_t {
  Display,
  Microphone,
  Amplifier,
  Speaker,
  Ptt,
  Battery,
  Nfc,
  Imu,
  Haptic,
  Count,
};

// Fail-closed ordering: an unknown peripheral is Absent, never Simulated.
enum class PeripheralMode : uint8_t {
  Absent = 0,
  Simulated = 1,
  Real = 2,
};

constexpr size_t kPeripheralCount = static_cast<size_t>(Peripheral::Count);

// Tracks, for every badge component, whether it is physically present, being
// simulated on the MCU, or simply absent. Detection is only trusted where the
// bus can actually answer; everything else stays Absent until an operator
// explicitly opts in to simulation.
class BadgeHal {
 public:
  void begin();

  PeripheralMode mode(Peripheral peripheral) const;
  const char* name(Peripheral peripheral) const;
  const char* bus(Peripheral peripheral) const;
  const char* evidence(Peripheral peripheral) const;
  const char* modeName(Peripheral peripheral) const;

  // True when the Rev A.1 pin contract actually routes this peripheral. A
  // peripheral with no pin allocation can never be simulated, which is what
  // stops the firmware from certifying hardware the board cannot host.
  bool hasPinAllocation(Peripheral peripheral) const;

  // Returns false when simulation is refused (no pin allocation, real hardware
  // already detected, or simulation compiled out).
  bool setSimulated(Peripheral peripheral, bool enabled);
  void setReal(Peripheral peripheral, const char* evidence);
  void setAbsent(Peripheral peripheral, const char* evidence);

  bool anySimulated() const;
  size_t simulatedCount() const;
  size_t realCount() const;

  // Probes the optional I2C bus and marks NFC/IMU/haptic Real when they ACK.
  // With nothing soldered the bus floats and every address stays Absent.
  void probeI2c();
  bool i2cBusUsable() const { return i2cBusUsable_; }

  void printModes(Print& out) const;

 private:
  PeripheralMode modes_[kPeripheralCount] = {};
  char evidence_[kPeripheralCount][56] = {};
  bool i2cBusUsable_ = false;

  void setEvidence(Peripheral peripheral, const char* text);
};
