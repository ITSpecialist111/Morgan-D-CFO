#include "badge_display.h"

#include <SPI.h>

#include "board_config.h"
#include "morgan_avatar_rgb565.h"

namespace {
constexpr uint16_t kBackground = 0x0861;
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

void BadgeDisplay::begin() {
  SPI.begin(BadgeConfig::kDisplayClockPin,
            -1,
            BadgeConfig::kDisplayMosiPin,
            BadgeConfig::kDisplayCsPin);
  display_.init(BadgeConfig::kDisplayWidth, BadgeConfig::kDisplayHeight);
  display_.setRotation(BadgeConfig::kDisplayRotation);
  display_.setTextWrap(false);
  display_.fillScreen(kBackground);
}

void BadgeDisplay::render(BadgeState state,
                          bool cloudConnected,
                          float batteryVoltage,
                          const char* detail) {
  state_ = state;
  stateColor_ = colorForState(state);
  display_.fillScreen(kBackground);
  drawHeader(cloudConnected, batteryVoltage);
  drawAvatarPortrait();
  drawStateLabel(state, detail);
}

void BadgeDisplay::animate(uint32_t nowMs) {
  if (nowMs - lastAnimationMs_ < 120) return;
  lastAnimationMs_ = nowMs;
  pulseStep_ = (pulseStep_ + 1) % 12;

  const int16_t pulse = (pulseStep_ <= 6 ? pulseStep_ : 12 - pulseStep_) / 2;
  display_.fillRect(27, 40, 186, 5, kBackground);
  display_.fillRect(27, 221, 186, 5, kBackground);
  display_.fillRect(27, 40, 5, 186, kBackground);
  display_.fillRect(208, 40, 5, 186, kBackground);
  display_.drawRoundRect(32 - pulse, 45 - pulse,
                         176 + pulse * 2, 176 + pulse * 2,
                         10, stateColor_);

  if (state_ == BadgeState::Listening || state_ == BadgeState::Speaking) {
    for (uint8_t bar = 0; bar < 5; ++bar) {
      const uint8_t phase = (pulseStep_ + bar * 2) % 12;
      const int16_t height = 3 + (phase <= 6 ? phase : 12 - phase) * 2;
      const int16_t x = 96 + bar * 12;
      display_.fillRect(x, 271, 5, 15, kBackground);
      display_.fillRoundRect(x, 286 - height, 5, height, 2, stateColor_);
    }
  }
}

void BadgeDisplay::drawHeader(bool cloudConnected, float batteryVoltage) {
  display_.fillRect(0, 0, BadgeConfig::kDisplayWidth, 36, kPanel);
  display_.setTextColor(ST77XX_WHITE);
  display_.setTextSize(2);
  display_.setCursor(12, 10);
  display_.print("MORGAN");

  display_.setTextSize(1);
  display_.setTextColor(cloudConnected ? kSpeaking : kMuted);
  display_.setCursor(150, 7);
  display_.print(cloudConnected ? "CLOUD" : "LOCAL");
  display_.setTextColor(kMuted);
  display_.setCursor(150, 21);
  if (batteryVoltage > 2.5F && batteryVoltage < 4.5F) {
    display_.print(batteryVoltage, 2);
    display_.print("V");
  } else {
    display_.print("BAT --");
  }
}

void BadgeDisplay::drawAvatarPortrait() {
  constexpr int16_t avatarX =
      (BadgeConfig::kDisplayWidth - kMorganAvatarWidth) / 2;
  constexpr int16_t avatarY = 49;
  display_.drawRGBBitmap(avatarX, avatarY, kMorganAvatarRgb565,
                         kMorganAvatarWidth, kMorganAvatarHeight);
  display_.drawRoundRect(34, 47, 172, 172, 8, stateColor_);
}

void BadgeDisplay::drawStateLabel(BadgeState state, const char* detail) {
  display_.setTextColor(stateColor_);
  display_.setTextSize(2);
  const char* label = badgeStateName(state);
  const int16_t labelWidth = strlen(label) * 12;
  display_.setCursor((BadgeConfig::kDisplayWidth - labelWidth) / 2, 224);
  display_.print(label);

  display_.setTextColor(kMuted);
  display_.setTextSize(1);
  display_.setCursor(12, 249);
  String detailText = detail && detail[0] ? detail : "Digital CFO";
  if (detailText.length() > 34) {
    detailText = detailText.substring(0, 31) + "...";
  }
  display_.print(detailText);
}
