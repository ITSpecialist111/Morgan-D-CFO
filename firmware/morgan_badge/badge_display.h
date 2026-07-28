#pragma once

#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>

#include "badge_canvas.h"
#include "badge_hal.h"
#include "badge_types.h"

// Draws the badge UI into an offscreen PSRAM canvas and blits it to the ST7789.
//
// Blitting is deliberately independent of panel detection: many ST7789
// breakouts omit the SDO line, so readback can fail on a working display.
// Detection is used for reporting only.
//
// Keeping one drawing path means the pixels verified on the bench with no
// display fitted are the same pixels the panel will later receive.
class BadgeDisplay {
 public:
  // Base colour of the badge UI. Exposed so a test can distinguish a genuinely
  // rendered frame from one that is merely filled with the background.
  static constexpr uint16_t kBackgroundColor = 0x0861;

  BadgeDisplay();

  bool begin(BadgeHal* hal, BadgeCanvas* canvas);
  void render(BadgeState state,
              bool cloudConnected,
              float batteryVoltage,
              const char* detail);
  void animate(uint32_t nowMs);

  bool panelDetected() const { return panelDetected_; }
  uint8_t readbackId() const { return readbackId_; }

 private:
  Adafruit_ST7789 display_;
  BadgeHal* hal_ = nullptr;
  BadgeCanvas* canvas_ = nullptr;
  BadgeState state_ = BadgeState::Boot;
  uint16_t stateColor_ = ST77XX_WHITE;
  uint32_t lastAnimationMs_ = 0;
  uint8_t pulseStep_ = 0;
  bool panelDetected_ = false;
  uint8_t readbackId_ = 0;

  // Attempts an ST7789 register read. Only a plausible, non-floating answer is
  // accepted as proof that a panel is present.
  bool probePanel();

  void present();
  void blitRegion(int16_t x, int16_t y, int16_t width, int16_t height);

  void drawHeader(Adafruit_GFX& target, bool cloudConnected, float batteryVoltage);
  void drawAvatarPortrait(Adafruit_GFX& target);
  void drawStateLabel(Adafruit_GFX& target, BadgeState state, const char* detail);
};
