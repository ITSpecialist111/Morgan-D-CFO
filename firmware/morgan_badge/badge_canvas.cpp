#include "badge_canvas.h"

#include <esp_heap_caps.h>

BadgeCanvas::BadgeCanvas(uint16_t width, uint16_t height)
    : Adafruit_GFX(static_cast<int16_t>(width), static_cast<int16_t>(height)),
      width_(width),
      height_(height) {}

BadgeCanvas::~BadgeCanvas() {
  if (buffer_ != nullptr) {
    heap_caps_free(buffer_);
    buffer_ = nullptr;
  }
}

size_t BadgeCanvas::bufferBytes() const {
  return static_cast<size_t>(width_) * height_ * sizeof(uint16_t);
}

bool BadgeCanvas::begin() {
  if (buffer_ != nullptr) return true;
  // MALLOC_CAP_SPIRAM fails loudly if PSRAM is missing or the board was built
  // without PSRAM=enabled, which is exactly the misconfiguration we want to
  // surface rather than silently falling back to DRAM.
  buffer_ = static_cast<uint16_t*>(
      heap_caps_malloc(bufferBytes(), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (buffer_ == nullptr) return false;
  fillScreen(0x0000);
  return true;
}

void BadgeCanvas::drawPixel(int16_t x, int16_t y, uint16_t color) {
  if (buffer_ == nullptr) return;
  if (x < 0 || y < 0 || x >= static_cast<int16_t>(width_) ||
      y >= static_cast<int16_t>(height_)) {
    return;
  }
  buffer_[static_cast<size_t>(y) * width_ + static_cast<size_t>(x)] = color;
}

void BadgeCanvas::fillScreen(uint16_t color) {
  if (buffer_ == nullptr) return;
  const size_t total = static_cast<size_t>(width_) * height_;
  for (size_t index = 0; index < total; ++index) {
    buffer_[index] = color;
  }
}

uint16_t BadgeCanvas::pixelAt(int16_t x, int16_t y) const {
  if (buffer_ == nullptr) return 0;
  if (x < 0 || y < 0 || x >= static_cast<int16_t>(width_) ||
      y >= static_cast<int16_t>(height_)) {
    return 0;
  }
  return buffer_[static_cast<size_t>(y) * width_ + static_cast<size_t>(x)];
}

uint32_t BadgeCanvas::regionCrc32(int16_t x, int16_t y, int16_t width,
                                  int16_t height) const {
  if (buffer_ == nullptr) return 0;
  uint32_t crc = 0xFFFFFFFFU;
  for (int16_t row = y; row < y + height; ++row) {
    if (row < 0 || row >= static_cast<int16_t>(height_)) continue;
    for (int16_t column = x; column < x + width; ++column) {
      if (column < 0 || column >= static_cast<int16_t>(width_)) continue;
      const uint16_t pixel =
          buffer_[static_cast<size_t>(row) * width_ + static_cast<size_t>(column)];
      const uint8_t bytes[2] = {static_cast<uint8_t>(pixel & 0xFF),
                                static_cast<uint8_t>(pixel >> 8)};
      for (uint8_t byte : bytes) {
        crc ^= byte;
        for (uint8_t bit = 0; bit < 8; ++bit) {
          crc = (crc >> 1) ^ (0xEDB88320U & (~((crc & 1U) - 1U)));
        }
      }
    }
  }
  return ~crc;
}

uint32_t BadgeCanvas::countPixelsDifferentFrom(uint16_t color) const {
  if (buffer_ == nullptr) return 0;
  const size_t total = static_cast<size_t>(width_) * height_;
  uint32_t different = 0;
  for (size_t index = 0; index < total; ++index) {
    if (buffer_[index] != color) ++different;
  }
  return different;
}
