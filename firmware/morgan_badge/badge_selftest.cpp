#include "badge_selftest.h"

#include <esp_heap_caps.h>
#include <soc/gpio_reg.h>

#include <cmath>

#include "board_config.h"

namespace {
// Sustained capture length used to measure the live I2S rate. Long enough that
// DMA buffering is amortised, short enough to keep the test responsive.
constexpr size_t kCaptureFrames = 2400;
constexpr uint32_t kExpectedCaptureMicros =
    static_cast<uint32_t>(kCaptureFrames) * 1000000UL / BadgeConfig::kAudioSampleRate;
// Accept +/-2 %. The measured error on silicon is ~0.003 %, so a loose window
// would let a wrong BCLK divider pass unnoticed.
constexpr uint32_t kCaptureToleranceMicros = kExpectedCaptureMicros / 50;
}  // namespace

void BadgeSelfTest::beginChecks(Print& out) {
  out_ = &out;
  firstCheck_ = true;
  hardwarePass_ = 0;
  simulatedPass_ = 0;
  failed_ = 0;
  skipped_ = 0;
}

void BadgeSelfTest::addCheck(const char* id, const char* mode, bool pass,
                             const char* evidence) {
  if (out_ == nullptr) return;
  if (!firstCheck_) out_->print(',');
  firstCheck_ = false;

  const bool simulated = strcmp(mode, "simulated") == 0;
  // SIM-PASS and HW-PASS are deliberately different verdict tokens.
  const char* verdict = !pass ? "FAIL" : (simulated ? "SIM-PASS" : "HW-PASS");
  if (!pass) {
    ++failed_;
  } else if (simulated) {
    ++simulatedPass_;
  } else {
    ++hardwarePass_;
  }

  out_->print("{\"id\":\"");
  out_->print(id);
  out_->print("\",\"mode\":\"");
  out_->print(mode);
  out_->print("\",\"verdict\":\"");
  out_->print(verdict);
  out_->print("\",\"evidence\":\"");
  out_->print(evidence);
  out_->print("\"}");
}

void BadgeSelfTest::addSkipped(const char* id, const char* reason) {
  if (out_ == nullptr) return;
  if (!firstCheck_) out_->print(',');
  firstCheck_ = false;
  ++skipped_;
  out_->print("{\"id\":\"");
  out_->print(id);
  out_->print("\",\"mode\":\"absent\",\"verdict\":\"SKIPPED\",\"evidence\":\"");
  out_->print(reason);
  out_->print("\"}");
}

void BadgeSelfTest::endChecks() {
  if (out_ == nullptr) return;
  out_->print("],\"summary\":{\"hardwarePass\":");
  out_->print(hardwarePass_);
  out_->print(",\"simulatedPass\":");
  out_->print(simulatedPass_);
  out_->print(",\"failed\":");
  out_->print(failed_);
  out_->print(",\"skipped\":");
  out_->print(skipped_);
  out_->print("}}");
  out_->println();
}

void BadgeSelfTest::run(Print& out,
                        BadgeHal& hal,
                        BadgeAudio& audio,
                        BadgeCanvas& canvas,
                        BadgeDisplay& display,
                        BadgePeripherals& peripherals,
                        float batteryVolts) {
  char evidence[120];

  out.print("{\"event\":\"SELFTEST\",\"schemaVersion\":");
  out.print(kSchemaVersion);
  out.print(",\"firmware\":\"");
  out.print(BadgeConfig::kFirmwareVersion);
  out.print("\",\"pinContractRev\":");
  out.print(BadgeConfig::kPinContractRevision);
  out.print(",\"chip\":\"");
  out.print(ESP.getChipModel());
  out.print("\",\"chipRevision\":");
  out.print(ESP.getChipRevision());
  out.print(",\"simulationBuild\":");
  out.print(BADGE_ALLOW_SIMULATION ? "true" : "false");
  out.print(",\"checks\":[");

  beginChecks(out);

  // --- MCU identity -------------------------------------------------------
  snprintf(evidence, sizeof(evidence),
           "%s rev %u.%u, %u MHz, flash %u B, psram %u B", ESP.getChipModel(),
           ESP.getChipRevision() / 100, ESP.getChipRevision() % 100,
           ESP.getCpuFreqMHz(), ESP.getFlashChipSize(), ESP.getPsramSize());
  addCheck("mcu.identity", "real", ESP.getPsramSize() > 0 && ESP.getFlashChipSize() > 0,
           evidence);

  // --- Boot strapping audit ----------------------------------------------
  // Latched boot-time strap levels. GPIO27 is bit 0x04 and GPIO28 is bit 0x08.
  // A normal flash boot requires GPIO28 high; GPIO28 low means the part came up
  // in the ROM serial bootloader, which is a real condition worth failing on.
  const uint32_t strapRegister = REG_READ(GPIO_STRAP_REG);
  const bool normalBoot = (strapRegister & 0x08) != 0;
  snprintf(evidence, sizeof(evidence),
           "GPIO_STRAP 0x%08lX, GPIO28 %s (normal flash boot required)",
           static_cast<unsigned long>(strapRegister), normalBoot ? "high" : "low");
  addCheck("mcu.strapping", "real", normalBoot, evidence);

  // --- PSRAM framebuffer --------------------------------------------------
  const bool canvasReady = canvas.ready();
  snprintf(evidence, sizeof(evidence), "framebuffer %u B in PSRAM, free psram %u B",
           static_cast<unsigned>(canvas.bufferBytes()),
           static_cast<unsigned>(ESP.getFreePsram()));
  addCheck("psram.framebuffer", "real", canvasReady, evidence);

  // --- Rendered pixels ----------------------------------------------------
  if (canvasReady) {
    const uint32_t crc = canvas.regionCrc32(0, 0, BadgeConfig::kDisplayWidth,
                                            BadgeConfig::kDisplayHeight);
    // Counting against the UI background, not black, is what distinguishes a
    // genuinely drawn frame from one that is merely filled.
    const uint32_t painted =
        canvas.countPixelsDifferentFrom(BadgeDisplay::kBackgroundColor);
    const uint32_t total =
        static_cast<uint32_t>(BadgeConfig::kDisplayWidth) * BadgeConfig::kDisplayHeight;
    // The portrait alone is 168x168 = 28,224 px, so require at least that much
    // content while rejecting a frame with no background left at all.
    const bool pass = crc != 0 && painted >= 28224 && painted < total;
    snprintf(evidence, sizeof(evidence),
             "crc32 0x%08lX, %lu/%lu px differ from background; layout only",
             static_cast<unsigned long>(crc), static_cast<unsigned long>(painted),
             static_cast<unsigned long>(total));
    addCheck("display.render", "real", pass, evidence);
  } else {
    addSkipped("display.render", "framebuffer unavailable");
  }

  // --- Display panel ------------------------------------------------------
  if (display.panelDetected()) {
    snprintf(evidence, sizeof(evidence), "RDDID 0x%02X", display.readbackId());
    addCheck("display.panel", "real", true, evidence);
  } else {
    addSkipped("display.panel",
               "no RDDID readback; SPI configured but panel not verified");
  }

  // --- I2S peripheral -----------------------------------------------------
  const AudioCaptureStats capture = audio.measureCapture(kCaptureFrames);
  const bool timingOk =
      capture.framesRead == kCaptureFrames &&
      capture.elapsedMicros + kCaptureToleranceMicros > kExpectedCaptureMicros &&
      capture.elapsedMicros < kExpectedCaptureMicros + kCaptureToleranceMicros;
  snprintf(evidence, sizeof(evidence),
           "%u frames in %lu us (expected ~%lu us at %lu Hz)",
           static_cast<unsigned>(capture.framesRead),
           static_cast<unsigned long>(capture.elapsedMicros),
           static_cast<unsigned long>(kExpectedCaptureMicros),
           static_cast<unsigned long>(BadgeConfig::kAudioSampleRate));
  addCheck("i2s.clock", "real", audio.ready() && timingOk, evidence);

  // --- Microphone ---------------------------------------------------------
  // A fitted ICS-43434 always dithers around its noise floor, so the raw 24-bit
  // word varies across a capture. An unconnected MIC_SD line returns a constant
  // word. That difference is what lets a soldered board produce a hardware
  // verdict here instead of an unconditional skip.
  const bool microphoneSignalPresent =
      capture.rawSpread >= BadgeAudio::kMicrophonePresenceSpread;
  if (microphoneSignalPresent &&
      hal.mode(Peripheral::Microphone) != PeripheralMode::Simulated) {
    snprintf(evidence, sizeof(evidence), "live MIC_SD data, 24-bit spread %lu",
             static_cast<unsigned long>(capture.rawSpread));
    hal.setReal(Peripheral::Microphone, evidence);
  }
  const PeripheralMode micMode = hal.mode(Peripheral::Microphone);
  if (micMode == PeripheralMode::Absent) {
    snprintf(evidence, sizeof(evidence),
             "MIC_SD static: 24-bit spread %lu < %lu, raw [%ld,%ld]; not fitted",
             static_cast<unsigned long>(capture.rawSpread),
             static_cast<unsigned long>(BadgeAudio::kMicrophonePresenceSpread),
             static_cast<long>(capture.rawMin), static_cast<long>(capture.rawMax));
    addSkipped("audio.microphone", evidence);
  } else {
    snprintf(evidence, sizeof(evidence),
             "24-bit spread %lu, last 240 frames rms %.4f peak %.4f, clipped %lu/%u%s",
             static_cast<unsigned long>(capture.rawSpread), capture.rms,
             capture.peak, static_cast<unsigned long>(capture.clippedSamples),
             static_cast<unsigned>(kCaptureFrames),
             capture.synthetic ? " (synthetic PCM, no acoustic proof)" : "");
    // A hardware verdict additionally requires the line to still be carrying
    // data. Without this an intermittent joint that worked once would stay
    // promoted to Real and keep reporting HW-PASS on a dead line. Simulated
    // mode has no physical microphone by definition, so it is exempt.
    const bool micPass = capture.framesRead > 0 && capture.clippedSamples == 0 &&
                         (micMode != PeripheralMode::Real || microphoneSignalPresent);
    addCheck("audio.microphone", hal.modeName(Peripheral::Microphone), micPass,
             evidence);
  }

  // --- Amplifier control line --------------------------------------------
  audio.setAmplifierEnabled(true);
  const int ampHigh = digitalRead(BadgeConfig::kAmplifierSdPin);
  audio.setAmplifierEnabled(false);
  const int ampLow = digitalRead(BadgeConfig::kAmplifierSdPin);
  snprintf(evidence, sizeof(evidence),
           "AMP_SD gpio%u toggled %d->%d; no acoustic output implied",
           BadgeConfig::kAmplifierSdPin, ampHigh, ampLow);
  addCheck("audio.amplifierControl", "real", ampHigh == HIGH && ampLow == LOW,
           evidence);

  // The speaker is passive and cannot be sensed electrically from the MCU.
  addSkipped("audio.speaker", "passive load, not observable without soldering");

  // --- Push to talk -------------------------------------------------------
  const int pttLevel = digitalRead(BadgeConfig::kPttPin);
  snprintf(evidence, sizeof(evidence),
           "gpio%u reads %s with internal pull-up; %s",
           BadgeConfig::kPttPin, pttLevel == HIGH ? "HIGH" : "LOW",
           pttLevel == HIGH ? "consistent with released or unfitted switch"
                            : "line held low");
  addCheck("input.ptt", hal.modeName(Peripheral::Ptt), pttLevel == HIGH, evidence);

  // --- Battery sense ------------------------------------------------------
  const bool batteryPlausible = !std::isnan(batteryVolts) && batteryVolts > 0.2F;
  snprintf(evidence, sizeof(evidence),
           "%.3f V via 100k/100k divider after %lu ms settle; USB rail when no cell",
           static_cast<double>(batteryVolts),
           static_cast<unsigned long>(BadgeConfig::kBatterySettleMs));
  addCheck("power.batterySense", "real", batteryPlausible, evidence);

  // --- Optional I2C peripherals ------------------------------------------
  struct OptionalCheck {
    const char* id;
    Peripheral peripheral;
  };
  const OptionalCheck optional[] = {
      {"i2c.nfc", Peripheral::Nfc},
      {"i2c.imu", Peripheral::Imu},
      {"i2c.haptic", Peripheral::Haptic},
  };
  for (const OptionalCheck& entry : optional) {
    const PeripheralMode mode = hal.mode(entry.peripheral);
    if (mode == PeripheralMode::Absent) {
      addSkipped(entry.id, hal.evidence(entry.peripheral));
      continue;
    }
    bool pass = true;
    if (entry.peripheral == Peripheral::Imu) {
      const TiltReading tilt = peripherals.readTilt();
      pass = tilt.valid;
      snprintf(evidence, sizeof(evidence), "pitch %.1f roll %.1f interrupt %s",
               static_cast<double>(tilt.pitchDegrees),
               static_cast<double>(tilt.rollDegrees),
               tilt.motionInterrupt ? "true" : "false");
    } else if (entry.peripheral == Peripheral::Haptic) {
      pass = peripherals.playHaptic("click");
      snprintf(evidence, sizeof(evidence), "pattern %s for %u ms",
               peripherals.lastHapticPattern(), peripherals.lastHapticDurationMs());
    } else {
      uint32_t version = 0;
      if (mode == PeripheralMode::Real) {
        pass = peripherals.nfcFirmwareVersion(&version);
        snprintf(evidence, sizeof(evidence), "PN532 firmware 0x%08lX",
                 static_cast<unsigned long>(version));
      } else {
        snprintf(evidence, sizeof(evidence),
                 "simulated tap path only; passive target polling not implemented");
      }
    }
    addCheck(entry.id, hal.modeName(entry.peripheral), pass, evidence);
  }

  // --- Memory headroom ----------------------------------------------------
  snprintf(evidence, sizeof(evidence), "heap free %u B, min free %u B, psram free %u B",
           static_cast<unsigned>(ESP.getFreeHeap()),
           static_cast<unsigned>(ESP.getMinFreeHeap()),
           static_cast<unsigned>(ESP.getFreePsram()));
  addCheck("memory.headroom", "real", ESP.getFreeHeap() > 40000, evidence);

  endChecks();
}
