#pragma once

#include <Arduino.h>

// Morgan Smart ID Badge - Rev A.1 pin contract for the Seeed XIAO ESP32-C5.
//
// Strapping pins on ESP32-C5 are GPIO2, GPIO7, GPIO25, GPIO27 and GPIO28
// (Espressif ESP-IDF "GPIO & RTC GPIO" summary for esp32c5). Of the eleven
// front castellated pads only D2 (GPIO25) and D3 (GPIO7) land on strapping
// pins, so those two pads may only carry signals that drive a high-impedance
// module input with NO external pull resistor fitted. The chip has ~45k
// internal pulls, so an external 100k pull would not reliably win at reset.
//
// GPIO28 selects the ROM serial bootloader and GPIO27 must be high to enter it
// reliably. Both are owned by the XIAO (BOOT button and user LED).
namespace BadgeConfig {
constexpr char kFirmwareVersion[] = "0.2.0";
constexpr uint8_t kPinContractRevision = 1;  // Rev A.1

// ---------------------------------------------------------------------------
// Front castellated pads (core badge, must be soldered)
// ---------------------------------------------------------------------------
constexpr uint8_t kPttPin = D0;             // GPIO1  - switch to GND, internal pull-up.
constexpr uint8_t kAmplifierSdPin = D1;     // GPIO0  - MAX98357A SD/MODE + external 100k pull-down.
constexpr uint8_t kDisplayDcPin = D2;       // GPIO25 - strapping pin, no external pull.
constexpr uint8_t kDisplayCsPin = D3;       // GPIO7  - strapping pin, no external pull.
constexpr uint8_t kMicrophoneDataPin = D4;  // GPIO23 - ICS-43434 SD -> MCU.
constexpr uint8_t kI2sWordSelectPin = D5;   // GPIO24 - shared LRCLK/WS.
constexpr uint8_t kI2sBitClockPin = D6;     // GPIO11 - shared BCLK/SCK.
constexpr uint8_t kAmplifierDataPin = D7;   // GPIO12 - MCU -> MAX98357A DIN.
constexpr uint8_t kDisplayClockPin = D8;    // GPIO8  - LCD SCK.
constexpr uint8_t kDisplayMisoPin = D9;     // GPIO9  - optional LCD SDO for register readback.
constexpr uint8_t kDisplayMosiPin = D10;    // GPIO10 - LCD MOSI.

// ---------------------------------------------------------------------------
// Rear JTAG bonding pads (optional Rev B daughterboard)
// ---------------------------------------------------------------------------
// Using these costs external JTAG debug only. USB flashing and the serial
// console run on the USB Serial/JTAG controller (GPIO13/GPIO14) and are
// unaffected. MTMS/GPIO2 is a strapping pin and is deliberately left free.
constexpr uint8_t kI2cSclPin = 3;             // MTDI - non-strapping.
constexpr uint8_t kI2cSdaPin = 4;             // MTCK - non-strapping.
constexpr int8_t kDisplayResetPin = 5;        // MTDO - non-strapping, software panel recovery.
constexpr uint8_t kReservedStrappingPin = 2;  // MTMS - must stay unconnected.

// ---------------------------------------------------------------------------
// Compile-time protection for the strapping rule
// ---------------------------------------------------------------------------
constexpr bool isStrappingPin(uint8_t gpio) {
  return gpio == 2 || gpio == 7 || gpio == 25 || gpio == 27 || gpio == 28;
}

// Nets that carry an external pull resistor must never sit on a strapping pin.
static_assert(!isStrappingPin(kAmplifierSdPin),
              "AMP_SD has an external 100k pull-down and cannot use a strapping pin");
static_assert(!isStrappingPin(kPttPin),
              "PTT is pulled by a switch and cannot use a strapping pin");
static_assert(!isStrappingPin(kI2cSclPin) && !isStrappingPin(kI2cSdaPin),
              "I2C needs external pull-ups and cannot use strapping pins");
static_assert(!isStrappingPin(static_cast<uint8_t>(kDisplayResetPin)),
              "LCD_RST must hold a level through reset and cannot use a strapping pin");
static_assert(kI2cSclPin != kI2cSdaPin, "I2C pins must differ");

// Every allocated pin must be unique. Without this a variant change that made
// two aliases resolve to the same GPIO would silently short two nets together.
constexpr uint8_t kAllocatedPins[] = {
    kPttPin,           kAmplifierSdPin,   kDisplayDcPin,
    kDisplayCsPin,     kMicrophoneDataPin, kI2sWordSelectPin,
    kI2sBitClockPin,   kAmplifierDataPin, kDisplayClockPin,
    kDisplayMisoPin,   kDisplayMosiPin,   kI2cSclPin,
    kI2cSdaPin,        static_cast<uint8_t>(kDisplayResetPin),
    kReservedStrappingPin,
};

constexpr bool allPinsDistinct() {
  for (size_t outer = 0; outer < sizeof(kAllocatedPins); ++outer) {
    for (size_t inner = outer + 1; inner < sizeof(kAllocatedPins); ++inner) {
      if (kAllocatedPins[outer] == kAllocatedPins[inner]) return false;
    }
  }
  return true;
}

static_assert(allPinsDistinct(), "Two badge nets resolve to the same GPIO");

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------
constexpr uint16_t kDisplayWidth = 240;
constexpr uint16_t kDisplayHeight = 320;
constexpr uint8_t kDisplayRotation = 0;
constexpr size_t kFramebufferBytes =
    static_cast<size_t>(kDisplayWidth) * kDisplayHeight * sizeof(uint16_t);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
// Azure Voice Live speaks 24 kHz mono PCM16, so the badge clocks I2S at the
// same rate to avoid on-device resampling. 24 kHz x 64 BCLK/frame = 1.536 MHz.
constexpr uint32_t kAudioSampleRate = 24000;
constexpr uint32_t kI2sBitsPerFrame = 64;
// ICS-43434 presents 24-bit data MSB-aligned in a 32-bit slot, so bits 31..8
// hold the sample. Shifting by 16 is the unity-gain 16-bit extraction.
constexpr uint8_t kMicrophoneShift = 16;
// Time for the I2S DMA queue to clock out before the amplifier is muted.
constexpr uint32_t kAmplifierDrainMs = 40;

// ---------------------------------------------------------------------------
// Optional I2C peripherals (Rev B)
// ---------------------------------------------------------------------------
constexpr uint8_t kNfcAddress = 0x24;     // PN532 in I2C mode.
constexpr uint8_t kImuAddress = 0x68;     // MPU6050 with AD0 low.
constexpr uint8_t kHapticAddress = 0x5A;  // DRV2605L.
constexpr uint32_t kI2cClockHz = 100000;

// ---------------------------------------------------------------------------
// Timing and behaviour
// ---------------------------------------------------------------------------
constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kTelemetryIntervalMs = 5000;
constexpr uint32_t kButtonDebounceMs = 35;
constexpr uint32_t kOfflineThinkingMs = 900;
constexpr uint32_t kOfflineSpeakingMs = 1100;
constexpr size_t kBatterySamples = 16;
// The battery divider is 100k/100k, so the ADC sees a ~50k source. Allow the
// sample-and-hold to settle after the load switch closes.
constexpr uint32_t kBatterySettleMs = 20;
constexpr float kBatteryDividerRatio = 2.0F;
}  // namespace BadgeConfig
