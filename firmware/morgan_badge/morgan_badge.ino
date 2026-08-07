#include <Arduino.h>

#include <cmath>

#include "badge_audio.h"
#include "badge_canvas.h"
#include "badge_display.h"
#include "badge_hal.h"
#include "badge_network.h"
#include "badge_peripherals.h"
#include "badge_selftest.h"
#include "badge_types.h"
#include "board_config.h"

namespace {
BadgeHal hal;
BadgeCanvas canvas(BadgeConfig::kDisplayWidth, BadgeConfig::kDisplayHeight);
BadgeAudio audio;
BadgeDisplay badgeDisplay;
BadgeNetwork network;
BadgePeripherals peripherals;
BadgeSelfTest selfTest;

BadgeState currentState = BadgeState::Boot;
uint32_t stateEnteredMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastButtonChangeMs = 0;
bool rawButtonPressed = false;
bool stableButtonPressed = false;
float batteryVoltage = NAN;
String serialCommand;

// The XIAO user LED on GPIO27 is wired active low, so driving the pin LOW
// lights it. Confirmed visually on the attached board 2026-07-28: a
// STANDBY/LISTENING square wave produced a dark LED in STANDBY and a lit LED
// in LISTENING, matching these constants.
constexpr uint8_t kUserLedOn = LOW;
constexpr uint8_t kUserLedOff = HIGH;

uint8_t ledLevelForState(BadgeState state) {
  switch (state) {
    case BadgeState::Listening:
    case BadgeState::Thinking:
    case BadgeState::Speaking:
    case BadgeState::Fault:
      return kUserLedOn;
    case BadgeState::Boot:
    case BadgeState::Standby:
    default:
      return kUserLedOff;
  }
}

float readBatteryVoltage() {
  // The divider is 100k/100k, so the ADC sees roughly a 50k source. Close the
  // load switch and let the sample-and-hold settle before sampling, otherwise
  // the reading sits low and drifts.
  digitalWrite(BAT_VOLT_PIN_EN, HIGH);
  delay(BadgeConfig::kBatterySettleMs);

  uint32_t totalMillivolts = 0;
  for (size_t sample = 0; sample < BadgeConfig::kBatterySamples; ++sample) {
    totalMillivolts += analogReadMilliVolts(BAT_VOLT_PIN);
  }

  digitalWrite(BAT_VOLT_PIN_EN, LOW);
  return BadgeConfig::kBatteryDividerRatio * static_cast<float>(totalMillivolts) /
         static_cast<float>(BadgeConfig::kBatterySamples) / 1000.0F;
}

void printBoardIdentity() {
  Serial.printf(
      "{\"event\":\"BOOT\",\"firmware\":\"morgan-badge\","
      "\"version\":\"%s\",\"pinContractRev\":%u,"
      "\"chip\":\"%s\",\"revision\":%u,\"cpuMHz\":%u,"
      "\"flashBytes\":%u,\"psramBytes\":%u}\n",
      BadgeConfig::kFirmwareVersion, BadgeConfig::kPinContractRevision,
      ESP.getChipModel(), ESP.getChipRevision(), ESP.getCpuFreqMHz(),
      ESP.getFlashChipSize(), ESP.getPsramSize());
}

void printPowerStatus() {
  batteryVoltage = readBatteryVoltage();
  Serial.printf(
      "{\"event\":\"PWR\",\"batteryVolts\":%.3f,"
      "\"batteryPresence\":\"unverified\",\"uptimeMs\":%lu}\n",
      batteryVoltage, millis());
}

void enterState(BadgeState nextState, const char* reason) {
  // Everything below is guarded by an actual state change. Re-rendering here on
  // every repeated call would repaint the whole frame for each streamed audio
  // chunk and stall playback.
  if (currentState == nextState) return;

  currentState = nextState;
  stateEnteredMs = millis();
  digitalWrite(LED_BUILTIN, ledLevelForState(nextState));
  badgeDisplay.render(currentState, network.cloudConnected(), batteryVoltage,
                      reason);
  Serial.printf(
      "{\"event\":\"STATE\",\"state\":\"%s\",\"reason\":\"%s\","
      "\"uptimeMs\":%lu}\n",
      badgeStateName(currentState), reason, millis());
}

void handleButton(uint32_t nowMs) {
  const bool pressed = digitalRead(BadgeConfig::kPttPin) == LOW;
  if (pressed != rawButtonPressed) {
    rawButtonPressed = pressed;
    lastButtonChangeMs = nowMs;
  }
  if (nowMs - lastButtonChangeMs < BadgeConfig::kButtonDebounceMs ||
      stableButtonPressed == rawButtonPressed) {
    return;
  }

  stableButtonPressed = rawButtonPressed;
  if (stableButtonPressed) {
    if (!network.startVoice()) {
      enterState(BadgeState::Listening, "Push-to-talk - local mode");
    }
  } else if (currentState == BadgeState::Listening) {
    if (network.voiceConnected()) {
      network.finishVoiceInput();
    } else {
      enterState(BadgeState::Thinking, "Local prototype response");
    }
  }
}

bool applySimulation(const String& target, bool enabled) {
  struct Entry {
    const char* name;
    Peripheral peripheral;
  };
  const Entry entries[] = {
      {"display", Peripheral::Display},   {"microphone", Peripheral::Microphone},
      {"amplifier", Peripheral::Amplifier}, {"speaker", Peripheral::Speaker},
      {"ptt", Peripheral::Ptt},           {"battery", Peripheral::Battery},
      {"nfc", Peripheral::Nfc},           {"imu", Peripheral::Imu},
      {"haptic", Peripheral::Haptic},
  };

  bool matched = false;
  for (const Entry& entry : entries) {
    if (target != "all" && target != entry.name) continue;
    matched = true;
    // Never touch a peripheral that genuinely answered on its bus: enabling
    // would mask it, and disabling would erase real detection evidence.
    if (hal.mode(entry.peripheral) == PeripheralMode::Real) continue;
    hal.setSimulated(entry.peripheral, enabled);
  }
  return matched;
}

void handleSerialCommand(const String& command) {
  if (command == "standby") {
    enterState(BadgeState::Standby, "Serial command");
  } else if (command == "listen") {
    enterState(BadgeState::Listening, "Serial command");
  } else if (command == "think") {
    enterState(BadgeState::Thinking, "Serial command");
  } else if (command == "speak") {
    enterState(BadgeState::Speaking, "Serial command");
    audio.playConfirmationTone();
  } else if (command == "voice") {
    if (!network.startVoice()) {
      Serial.println(
          "{\"event\":\"ERROR\",\"message\":\"Voice is not ready or is already active\"}");
    }
  } else if (command == "cancel") {
    network.cancelVoice();
  } else if (command == "selftest") {
    batteryVoltage = readBatteryVoltage();
    selfTest.run(Serial, hal, audio, canvas, badgeDisplay, peripherals,
                 batteryVoltage);
  } else if (command == "modes") {
    hal.printModes(Serial);
  } else if (command.startsWith("pttwait")) {
    // Operator-in-the-loop continuity check. A released switch and a missing
    // switch both read HIGH, so the only proof the PTT is actually soldered is
    // observing a real press while someone pushes it.
    const uint32_t timeoutMs = 10000;
    const uint32_t startedMs = millis();
    bool sawLow = false;
    bool sawRelease = false;
    Serial.println(
        "{\"event\":\"PTTWAIT\",\"stage\":\"waiting\",\"timeoutMs\":10000}");
    while (millis() - startedMs < timeoutMs) {
      const bool pressed = digitalRead(BadgeConfig::kPttPin) == LOW;
      if (pressed) sawLow = true;
      if (sawLow && !pressed) { sawRelease = true; break; }
      delay(5);
    }
    Serial.printf(
        "{\"event\":\"PTTWAIT\",\"stage\":\"done\",\"pressed\":%s,"
        "\"released\":%s,\"elapsedMs\":%lu}\n",
        sawLow ? "true" : "false", sawRelease ? "true" : "false",
        static_cast<unsigned long>(millis() - startedMs));
  } else if (command == "scan") {
    hal.probeI2c();
    peripherals.begin(&hal);
    hal.printModes(Serial);
  } else if (command.startsWith("sim ")) {
    String argument = command.substring(4);
    argument.trim();
    const int space = argument.indexOf(' ');
    String target = space < 0 ? argument : argument.substring(0, space);
    String action = space < 0 ? String("on") : argument.substring(space + 1);
    target.trim();
    action.trim();
    const bool enabled = action != "off";
    if (applySimulation(target, enabled)) {
      hal.printModes(Serial);
    } else {
      Serial.println(
          "{\"event\":\"ERROR\",\"message\":\"Unknown simulation target\"}");
    }
  } else if (command.startsWith("tilt ")) {
    String argument = command.substring(5);
    argument.trim();
    const int space = argument.indexOf(' ');
    const float pitch = argument.substring(0, space < 0 ? argument.length() : space).toFloat();
    const float roll = space < 0 ? 0.0F : argument.substring(space + 1).toFloat();
    peripherals.simulateTilt(pitch, roll);
    const TiltReading reading = peripherals.readTilt();
    Serial.printf(
        "{\"event\":\"IMU\",\"mode\":\"%s\",\"pitch\":%.1f,\"roll\":%.1f,"
        "\"motionInterrupt\":%s,\"valid\":%s}\n",
        hal.modeName(Peripheral::Imu), reading.pitchDegrees, reading.rollDegrees,
        reading.motionInterrupt ? "true" : "false",
        reading.valid ? "true" : "false");
  } else if (command == "tap" || command == "tap deny") {
    peripherals.simulateNfcTap(command == "tap");
    const NfcTap tap = peripherals.pollNfc();
    Serial.printf(
        "{\"event\":\"NFC\",\"mode\":\"%s\",\"present\":%s,\"authorized\":%s,"
        "\"uid\":\"%s\"}\n",
        hal.modeName(Peripheral::Nfc), tap.present ? "true" : "false",
        tap.authorized ? "true" : "false", tap.uid);
  } else if (command.startsWith("haptic ")) {
    String pattern = command.substring(7);
    pattern.trim();
    const bool played = peripherals.playHaptic(pattern.c_str());
    Serial.printf(
        "{\"event\":\"HAPTIC\",\"mode\":\"%s\",\"pattern\":\"%s\","
        "\"durationMs\":%u,\"played\":%s}\n",
        hal.modeName(Peripheral::Haptic), peripherals.lastHapticPattern(),
        peripherals.lastHapticDurationMs(), played ? "true" : "false");
  } else if (command == "diag") {
    printBoardIdentity();
    printPowerStatus();
    hal.printModes(Serial);
    network.printDiagnostics();
  } else if (command == "wifi") {
    network.printDiagnostics();
  } else if (command == "wifiscan") {
    network.printScan();
  } else if (command.length()) {
    Serial.println(
        "{\"event\":\"ERROR\",\"message\":\"Unknown command; use diag, modes, scan, selftest, sim, tilt, tap, haptic, standby, listen, think, speak, voice, cancel, or wifi\"}");
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    const char character = static_cast<char>(Serial.read());
    if (character == '\n' || character == '\r') {
      serialCommand.trim();
      handleSerialCommand(serialCommand);
      serialCommand = "";
    } else if (serialCommand.length() < 40) {
      serialCommand += character;
    }
  }
}

void runOfflineStateMachine(uint32_t nowMs) {
  // When a cloud voice session is live the service owns the response timing.
  // Running the local fallback here would stomp an in-flight reply.
  if (network.voiceConnected()) return;

  if (currentState == BadgeState::Thinking &&
      nowMs - stateEnteredMs >= BadgeConfig::kOfflineThinkingMs) {
    enterState(BadgeState::Speaking, "Cloud not configured");
    audio.playConfirmationTone();
  } else if (currentState == BadgeState::Speaking &&
             nowMs - stateEnteredMs >= BadgeConfig::kOfflineSpeakingMs) {
    enterState(BadgeState::Standby, "Ready");
  }
}
}  // namespace

const char* badgeStateName(BadgeState state) {
  switch (state) {
    case BadgeState::Boot:
      return "BOOT";
    case BadgeState::Standby:
      return "STANDBY";
    case BadgeState::Listening:
      return "LISTENING";
    case BadgeState::Thinking:
      return "THINKING";
    case BadgeState::Speaking:
      return "SPEAKING";
    case BadgeState::Fault:
      return "FAULT";
    default:
      return "UNKNOWN";
  }
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, kUserLedOff);

  pinMode(BadgeConfig::kPttPin, INPUT_PULLUP);

  pinMode(BAT_VOLT_PIN, INPUT);
  pinMode(BAT_VOLT_PIN_EN, OUTPUT);
  digitalWrite(BAT_VOLT_PIN_EN, LOW);

  Serial.begin(BadgeConfig::kSerialBaud);
  const uint32_t serialWaitStartedMs = millis();
  while (!Serial && millis() - serialWaitStartedMs < 3000) {
    delay(10);
  }

  printBoardIdentity();
  printPowerStatus();

  hal.begin();
  // The MCU-side parts are genuinely present, so they start Real.
  hal.setReal(Peripheral::Ptt, "gpio with internal pull-up");
  hal.setReal(Peripheral::Battery, "on-module divider and load switch");

  const bool canvasReady = canvas.begin();
  if (!canvasReady) {
    Serial.println(
        "{\"event\":\"ERROR\",\"message\":\"PSRAM framebuffer allocation failed; build with PSRAM=enabled\"}");
  }

  badgeDisplay.begin(&hal, &canvas);
  badgeDisplay.render(BadgeState::Boot, false, batteryVoltage,
                      "Hardware self-test");

  const bool audioReady = audio.begin(&hal);
  if (audioReady) {
    hal.setReal(Peripheral::Amplifier, "i2s tx channel started");
  }

  hal.probeI2c();
  peripherals.begin(&hal);

  Serial.printf(
      "{\"event\":\"SELFTEST\",\"stage\":\"boot\",\"framebuffer\":\"%s\","
      "\"audioBus\":\"%s\",\"displayPanel\":\"%s\","
      "\"externalModules\":\"not-detectable-until-wired\"}\n",
      canvasReady ? "ready" : "failed", audioReady ? "ready" : "failed",
      badgeDisplay.panelDetected() ? "detected" : "absent");
  hal.printModes(Serial);

  network.begin(
      &audio,
      [](BadgeState state, const char* detail) { enterState(state, detail); },
      [](const char* detail) {
        if (currentState == BadgeState::Standby) {
          badgeDisplay.render(currentState, network.cloudConnected(),
                              batteryVoltage, detail);
        }
      });
  enterState(audioReady ? BadgeState::Standby : BadgeState::Fault,
             audioReady ? "Ready - local mode" : "I2S initialization failed");
}

void loop() {
  const uint32_t nowMs = millis();
  readSerialCommands();
  handleButton(nowMs);
  runOfflineStateMachine(nowMs);
  network.loop(currentState, batteryVoltage);

  if (currentState == BadgeState::Listening && network.voiceConnected() &&
      stableButtonPressed) {
    static int16_t microphoneSamples[240];
    const size_t samplesRead =
        audio.readMicrophone(microphoneSamples, 240);
    network.sendMicrophone(microphoneSamples, samplesRead);
  }
  badgeDisplay.animate(nowMs);
  // Read the clock again here: network.loop() above may have queued playback
  // during this same iteration, so the loop-entry timestamp would be older than
  // lastPlaybackMs_ and the unsigned subtraction would wrap.
  audio.serviceAmplifier(millis());

  if (nowMs - lastTelemetryMs >= BadgeConfig::kTelemetryIntervalMs) {
    lastTelemetryMs = nowMs;
    printPowerStatus();
  }
}