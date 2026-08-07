#include "badge_display.h"

#include <SPI.h>

#include "board_config.h"
#include "morgan_avatar_rgb565.h"

namespace {
constexpr uint16_t kBackground = BadgeDisplay::kBackgroundColor;
constexpr uint16_t kPanel = 0x10E3;
constexpr uint16_t kMuted = 0x9CF3;
constexpr uint16_t kStandby = 0xE6B5;
constexpr uint16_t kListening = 0x3D7F;
constexpr uint16_t kThinking = 0x717D;
constexpr uint16_t kSpeaking = 0x2E8B;
constexpr uint16_t kFault = 0xF986;

uint16_t colorForState(BadgeState state) {
  switch (state) {
    case BadgeState::Listening:
      return kListening;
    case BadgeState::Thinking:
      return kThinking;
    case BadgeState::Speaking:
      return kSpeaking;
    case BadgeState::Fault:
      return kFault;
    case BadgeState::Boot:
    case BadgeState::Standby:
    default:
      return kStandby;
  }
}
}  // namespace

BadgeDisplay::BadgeDisplay()
    : display_(&SPI,
               BadgeConfig::kDisplayCsPin,
               BadgeConfig::kDisplayDcPin,
               BadgeConfig::kDisplayResetPin) {}

bool BadgeDisplay::probePanel() {
  // With no panel fitted the MISO line floats, which reads back as all-zero or
  // all-one. Only a plausible identifier is treated as evidence of hardware.
  readbackId_ = display_.readcommand8(ST77XX_RDDID);
  return readbackId_ != 0x00 && readbackId_ != 0xFF;
}

bool BadgeDisplay::begin(BadgeHal* hal, BadgeCanvas* canvas) {
  hal_ = hal;
  canvas_ = canvas;

  SPI.begin(BadgeConfig::kDisplayClockPin,
            BadgeConfig::kDisplayMisoPin,
            BadgeConfig::kDisplayMosiPin,
            BadgeConfig::kDisplayCsPin);
  display_.init(BadgeConfig::kDisplayWidth, BadgeConfig::kDisplayHeight);
  display_.setRotation(BadgeConfig::kDisplayRotation);
  display_.setTextWrap(false);

  panelDetected_ = probePanel();
  if (hal_ != nullptr) {
    if (panelDetected_) {
      char detail[56];
      snprintf(detail, sizeof(detail), "RDDID readback 0x%02X", readbackId_);
      hal_->setReal(Peripheral::Display, detail);
    } else {
      hal_->setAbsent(Peripheral::Display, "no RDDID readback; bus configured only");
    }
  }

  if (canvas_ != nullptr && canvas_->ready()) {
    canvas_->setTextWrap(false);
    canvas_->fillScreen(kBackground);
  }
  display_.fillScreen(kBackground);
  return canvas_ != nullptr && canvas_->ready();
}

void BadgeDisplay::present() {
  if (canvas_ == nullptr || !canvas_->ready()) return;
  blitRegion(0, 0, BadgeConfig::kDisplayWidth, BadgeConfig::kDisplayHeight);
}

void BadgeDisplay::blitRegion(int16_t x, int16_t y, int16_t width, int16_t height) {
  // Blitting is deliberately NOT gated on panel detection. Many ST7789
  // breakouts omit the SDO line, so readback can fail on a perfectly good
  // display; gating here would leave such a panel permanently blank. Writing
  // SPI to an absent panel is harmless.
  if (canvas_ == nullptr || !canvas_->ready()) return;
  if (width <= 0 || height <= 0) return;

  uint16_t* buffer = canvas_->buffer();
  display_.startWrite();
  display_.setAddrWindow(x, y, width, height);
  for (int16_t row = 0; row < height; ++row) {
    const size_t offset =
        static_cast<size_t>(y + row) * BadgeConfig::kDisplayWidth + static_cast<size_t>(x);
    display_.writePixels(buffer + offset, static_cast<uint32_t>(width));
  }
  display_.endWrite();
}

void BadgeDisplay::render(BadgeState state,
                          bool cloudConnected,
                          float batteryVoltage,
                          const char* detail) {
  state_ = state;
  stateColor_ = colorForState(state);
  if (canvas_ == nullptr || !canvas_->ready()) return;

  canvas_->fillScreen(kBackground);
  drawHeader(*canvas_, cloudConnected, batteryVoltage);
  drawAvatarPortrait(*canvas_);
  drawStateLabel(*canvas_, state, detail);
  present();
}

void BadgeDisplay::animate(uint32_t nowMs) {
  if (nowMs - lastAnimationMs_ < 120) return;
  lastAnimationMs_ = nowMs;
  if (canvas_ == nullptr || !canvas_->ready()) return;
  pulseStep_ = (pulseStep_ + 1) % 12;

  const int16_t pulse = (pulseStep_ <= 6 ? pulseStep_ : 12 - pulseStep_) / 2;
  // These bands must clear every pulse position (x 29..210, y 42..223 at max
  // pulse) while staying clear of the static UI: the accent frame occupies
  // x 34..205 / y 47..218, the avatar x 36..203 / y 49..216, and the STATE
  // label starts at y 224. Widening them further erases artwork that only a
  // full render() would restore.
  canvas_->fillRect(27, 40, 186, 7, kBackground);
  canvas_->fillRect(27, 219, 186, 5, kBackground);
  canvas_->fillRect(27, 40, 7, 186, kBackground);
  canvas_->fillRect(206, 40, 7, 186, kBackground);
  canvas_->drawRoundRect(32 - pulse, 45 - pulse,
                         176 + pulse * 2, 176 + pulse * 2,
                         10, stateColor_);
  // Only the animated band is pushed to the panel, not the whole frame.
  blitRegion(27, 40, 186, 186);

  if (state_ == BadgeState::Listening || state_ == BadgeState::Speaking) {
    for (uint8_t bar = 0; bar < 5; ++bar) {
      const uint8_t phase = (pulseStep_ + bar * 2) % 12;
      const int16_t height = 3 + (phase <= 6 ? phase : 12 - phase) * 2;
      const int16_t x = 96 + bar * 12;
      canvas_->fillRect(x, 271, 5, 15, kBackground);
      canvas_->fillRoundRect(x, 286 - height, 5, height, 2, stateColor_);
    }
    blitRegion(96, 271, 60, 15);
  }
}

void BadgeDisplay::drawHeader(Adafruit_GFX& target, bool cloudConnected,
                              float batteryVoltage) {
  target.fillRect(0, 0, BadgeConfig::kDisplayWidth, 36, kPanel);
  target.setTextColor(ST77XX_WHITE);
  target.setTextSize(2);
  target.setCursor(12, 10);
  target.print("MORGAN");

  target.setTextSize(1);
  target.setTextColor(cloudConnected ? kSpeaking : kMuted);
  target.setCursor(150, 7);
  target.print(cloudConnected ? "CLOUD" : "LOCAL");
  target.setTextColor(kMuted);
  target.setCursor(150, 21);
  if (batteryVoltage > 2.5F && batteryVoltage < 4.5F) {
    target.print(batteryVoltage, 2);
    target.print("V");
  } else {
    target.print("BAT --");
  }
}

void BadgeDisplay::drawAvatarPortrait(Adafruit_GFX& target) {
  constexpr int16_t avatarX =
      (BadgeConfig::kDisplayWidth - kMorganAvatarWidth) / 2;
  constexpr int16_t avatarY = 49;
  target.drawRGBBitmap(avatarX, avatarY, kMorganAvatarRgb565,
                       kMorganAvatarWidth, kMorganAvatarHeight);
  target.drawRoundRect(34, 47, 172, 172, 8, stateColor_);
}

void BadgeDisplay::drawStateLabel(Adafruit_GFX& target, BadgeState state,
                                  const char* detail) {
  target.setTextColor(stateColor_);
  target.setTextSize(2);
  const char* label = badgeStateName(state);
  const int16_t labelWidth = strlen(label) * 12;
  target.setCursor((BadgeConfig::kDisplayWidth - labelWidth) / 2, 224);
  target.print(label);

  target.setTextColor(kMuted);
  target.setTextSize(1);
  target.setCursor(12, 249);
  String detailText = detail && detail[0] ? detail : "Digital CFO";
  if (detailText.length() > 34) {
    detailText = detailText.substring(0, 31) + "...";
  }
  target.print(detailText);
}
