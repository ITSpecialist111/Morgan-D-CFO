#pragma once

#include <Arduino.h>

namespace BadgeConfig {
constexpr char kFirmwareVersion[] = "0.1.0";

// Front castellated pads on Seeed Studio XIAO ESP32-C5.
constexpr uint8_t kPttPin = D0;          // GPIO1, switch to GND.
constexpr uint8_t kDisplayCsPin = D1;    // GPIO0.
constexpr uint8_t kDisplayDcPin = D2;    // GPIO25.
constexpr uint8_t kAmplifierSdPin = D3;  // GPIO7, MAX98357A SD/MODE.
constexpr uint8_t kMicrophoneDataPin = D4;  // GPIO23, ICS-43434 SD -> MCU.
constexpr uint8_t kI2sWordSelectPin = D5;   // GPIO24, shared LRCLK/WS.
constexpr uint8_t kI2sBitClockPin = D6;     // GPIO11, shared BCLK/SCK.
constexpr uint8_t kAmplifierDataPin = D7;   // GPIO12, MCU -> MAX98357A DIN.
constexpr uint8_t kDisplayClockPin = D8;    // GPIO8.
constexpr uint8_t kStatusRgbPin = D9;       // GPIO9, reserved for V2 RGB LED.
constexpr uint8_t kDisplayMosiPin = D10;    // GPIO10.

// The display RST pin is tied to the XIAO RESET net in the schematic.
constexpr int8_t kDisplayResetPin = -1;
constexpr uint16_t kDisplayWidth = 240;
constexpr uint16_t kDisplayHeight = 320;
constexpr uint8_t kDisplayRotation = 0;

constexpr uint32_t kSerialBaud = 115200;
constexpr uint32_t kTelemetryIntervalMs = 5000;
constexpr uint32_t kButtonDebounceMs = 35;
constexpr uint32_t kOfflineThinkingMs = 900;
constexpr uint32_t kOfflineSpeakingMs = 1100;
constexpr uint32_t kAudioSampleRate = 24000;
constexpr size_t kBatterySamples = 16;
}  // namespace BadgeConfig
