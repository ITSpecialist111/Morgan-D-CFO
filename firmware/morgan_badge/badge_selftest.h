#pragma once

#include <Arduino.h>

#include "badge_audio.h"
#include "badge_canvas.h"
#include "badge_display.h"
#include "badge_hal.h"
#include "badge_peripherals.h"

// Structured pre-solder self-test.
//
// Every check reports the mode it ran in and the evidence it measured. Hardware
// passes and simulated passes are counted separately and never merged, so a
// bench run can never be presented as electrical verification.
class BadgeSelfTest {
 public:
  static constexpr uint8_t kSchemaVersion = 1;

  void run(Print& out,
           BadgeHal& hal,
           BadgeAudio& audio,
           BadgeCanvas& canvas,
           BadgeDisplay& display,
           BadgePeripherals& peripherals,
           float batteryVolts);

 private:
  Print* out_ = nullptr;
  bool firstCheck_ = true;
  uint16_t hardwarePass_ = 0;
  uint16_t simulatedPass_ = 0;
  uint16_t failed_ = 0;
  uint16_t skipped_ = 0;

  void beginChecks(Print& out);
  void addCheck(const char* id, const char* mode, bool pass, const char* evidence);
  void addSkipped(const char* id, const char* reason);
  void endChecks();
};
