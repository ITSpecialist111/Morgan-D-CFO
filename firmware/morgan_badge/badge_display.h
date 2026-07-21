#pragma once

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>

#include "badge_types.h"

class BadgeDisplay {
 public:
  BadgeDisplay();
  void begin();
  void render(BadgeState state,
              bool cloudConnected,
              float batteryVoltage,
              const char* detail);
  void animate(uint32_t nowMs);

 private:
  Adafruit_ST7789 display_;
  BadgeState state_ = BadgeState::Boot;
  uint16_t stateColor_ = ST77XX_WHITE;
  uint32_t lastAnimationMs_ = 0;
  uint8_t pulseStep_ = 0;

  void drawHeader(bool cloudConnected, float batteryVoltage);
  void drawAvatarPortrait();
  void drawStateLabel(BadgeState state, const char* detail);
};
