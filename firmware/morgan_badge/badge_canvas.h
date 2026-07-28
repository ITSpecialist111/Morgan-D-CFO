#pragma once

#include <Adafruit_GFX.h>
#include <Arduino.h>

// An offscreen RGB565 framebuffer held in PSRAM.
//
// The badge UI always draws here first, so the rendering logic can be verified
// pixel-by-pixel with no panel attached. When a real ST7789 is fitted the same
// buffer is blitted to it, which keeps one drawing path for both cases.
//
// 240 x 320 x 2 bytes = 153,600 bytes, far too large for the ~320 KB of DRAM
// once TLS and Wi-Fi buffers are live, so the allocation must come from PSRAM.
class BadgeCanvas : public Adafruit_GFX {
 public:
  BadgeCanvas(uint16_t width, uint16_t height);
  ~BadgeCanvas();

  bool begin();
  bool ready() const { return buffer_ != nullptr; }

  void drawPixel(int16_t x, int16_t y, uint16_t color) override;
  void fillScreen(uint16_t color) override;

  uint16_t* buffer() { return buffer_; }
  const uint16_t* buffer() const { return buffer_; }
  size_t bufferBytes() const;

  uint16_t pixelAt(int16_t x, int16_t y) const;

  // CRC32 over a region, used as the golden-value check for rendered output.
  uint32_t regionCrc32(int16_t x, int16_t y, int16_t width, int16_t height) const;

  // Counts pixels differing from the given colour, so a test can prove the
  // frame is not simply blank.
  uint32_t countPixelsDifferentFrom(uint16_t color) const;

 private:
  uint16_t* buffer_ = nullptr;
  uint16_t width_;
  uint16_t height_;
};
