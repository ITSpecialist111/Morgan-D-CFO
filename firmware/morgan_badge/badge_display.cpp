#include "badge_display.h"

#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <SPI.h>

#include "board_config.h"
#include "morgan_avatar_rgb565.h"

namespace {
constexpr uint16_t kBackground = BadgeDisplay::kBackgroundColor;
constexpr uint16_t kInk = 0xF7BE;
constexpr uint16_t kMuted = 0xB5B6;
constexpr uint16_t kStandby = 0xE6B5;
constexpr uint16_t kListening = 0x3D7F;
constexpr uint16_t kThinking = 0x717D;
constexpr uint16_t kSpeaking = 0x2E8B;
constexpr uint16_t kFault = 0xF986;

// Footer rows sit below the portrait's fade so text never overlaps the face.
constexpr int16_t kStateBaseline = 297;
constexpr int16_t kDetailBaseline = 312;
constexpr int16_t kBarsX = 192;
constexpr int16_t kBarsY = 284;
constexpr int16_t kBarsHeight = 14;

static_assert(kMorganAvatarTop + kMorganAvatarHeight <= BadgeConfig::kDisplayHeight,
              "Portrait must fit on the panel");

int16_t textWidth(Adafruit_GFX& target, const char* text) {
  int16_t x = 0;
  int16_t y = 0;
  uint16_t width = 0;
  uint16_t height = 0;
  target.getTextBounds(text, 0, 0, &x, &y, &width, &height);
  return static_cast<int16_t>(width);
}

void printCentered(Adafruit_GFX& target, const char* text, int16_t baseline) {
  int16_t x = 0;
  int16_t y = 0;
  uint16_t width = 0;
  uint16_t height = 0;
  target.getTextBounds(text, 0, baseline, &x, &y, &width, &height);
  target.setCursor((BadgeConfig::kDisplayWidth - static_cast<int16_t>(width)) / 2 - x,
                   baseline);
  target.print(text);
}

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

uint32_t BadgeDisplay::portraitContentPixels() {
  return kMorganAvatarContentPixels;
}

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

void BadgeDisplay::showColorBars() {
  if (canvas_ == nullptr || !canvas_->ready()) return;

  constexpr uint16_t colors[] = {
      ST77XX_RED, ST77XX_GREEN, ST77XX_BLUE, ST77XX_CYAN,
      ST77XX_MAGENTA, ST77XX_YELLOW, ST77XX_WHITE,
  };
  constexpr uint8_t colorCount = sizeof(colors) / sizeof(colors[0]);
  const int16_t bandHeight = BadgeConfig::kDisplayHeight / colorCount;
  for (uint8_t index = 0; index < colorCount; ++index) {
    const int16_t top = static_cast<int16_t>(index) * bandHeight;
    const int16_t height = index == colorCount - 1
                               ? BadgeConfig::kDisplayHeight - top
                               : bandHeight;
    canvas_->fillRect(0, top, BadgeConfig::kDisplayWidth, height, colors[index]);
  }
  present();
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
  drawPortrait(*canvas_);
  drawIdentity(*canvas_);
  drawFooter(*canvas_, state, cloudConnected, batteryVoltage, detail);
  present();
}

void BadgeDisplay::animate(uint32_t nowMs) {
  if (nowMs - lastAnimationMs_ < 120) return;
  lastAnimationMs_ = nowMs;
  if (canvas_ == nullptr || !canvas_->ready()) return;
  if (state_ != BadgeState::Listening && state_ != BadgeState::Thinking &&
      state_ != BadgeState::Speaking) {
    return;
  }
  pulseStep_ = (pulseStep_ + 1) % 12;
  // Only the footer bar strip changes, so the portrait is never redrawn.
  drawActivityBars(*canvas_);
  blitRegion(kBarsX, kBarsY, 30, kBarsHeight);
}

void BadgeDisplay::drawIdentity(Adafruit_GFX& target) {
  constexpr int16_t markLeft = 113;
  constexpr int16_t markTop = 26;
  target.fillRect(markLeft, markTop, 6, 6, kInk);
  target.fillRect(markLeft + 7, markTop, 6, 6, kInk);
  target.fillRect(markLeft, markTop + 7, 6, 6, kInk);
  target.fillRect(markLeft + 7, markTop + 7, 6, 6, kInk);

  target.setTextColor(kInk);
  target.setFont(&FreeSansBold12pt7b);
  printCentered(target, "Morgan", 66);

  target.setTextColor(kMuted);
  target.setFont(&FreeSans9pt7b);
  printCentered(target, "Digital CFO", 86);
  target.setFont(nullptr);
}

void BadgeDisplay::drawPortrait(Adafruit_GFX& target) {
  target.drawRGBBitmap(0, kMorganAvatarTop, kMorganAvatarRgb565,
                       kMorganAvatarWidth, kMorganAvatarHeight);
}

void BadgeDisplay::drawFooter(Adafruit_GFX& target, BadgeState state,
                              bool cloudConnected, float batteryVoltage,
                              const char* detail) {
  target.setTextColor(stateColor_);
  target.setFont(&FreeSansBold9pt7b);
  target.setCursor(12, kStateBaseline);
  target.print(badgeStateName(state));
  target.setFont(nullptr);

  target.setTextSize(1);
  target.setTextColor(kMuted);
  String detailText = detail && detail[0] ? detail : "Digital CFO";
  if (detailText.length() > 24) {
    detailText = detailText.substring(0, 21) + "...";
  }
  target.setCursor(12, kDetailBaseline - 7);
  target.print(detailText);

  char meta[20];
  if (batteryVoltage > 2.5F && batteryVoltage < 4.5F) {
    snprintf(meta, sizeof(meta), "%s %.2fV", cloudConnected ? "CLOUD" : "LOCAL",
             batteryVoltage);
  } else {
    snprintf(meta, sizeof(meta), "%s BAT--", cloudConnected ? "CLOUD" : "LOCAL");
  }
  target.setTextColor(cloudConnected ? kSpeaking : kMuted);
  target.setCursor(BadgeConfig::kDisplayWidth - 12 - textWidth(target, meta),
                   kDetailBaseline - 7);
  target.print(meta);

  drawActivityBars(target);
}

void BadgeDisplay::drawActivityBars(Adafruit_GFX& target) {
  target.fillRect(kBarsX, kBarsY, 30, kBarsHeight, kBackground);
  if (state_ != BadgeState::Listening && state_ != BadgeState::Thinking &&
      state_ != BadgeState::Speaking) {
    return;
  }
  for (uint8_t bar = 0; bar < 5; ++bar) {
    const uint8_t phase = (pulseStep_ + bar * 2) % 12;
    const int16_t height = 3 + (phase <= 6 ? phase : 12 - phase) * 2;
    target.fillRoundRect(kBarsX + bar * 6, kBarsY + kBarsHeight - height, 4,
                         height, 2, stateColor_);
  }
}
