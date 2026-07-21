#include <Arduino.h>

#include <cmath>

#include "badge_audio.h"
#include "badge_display.h"
#include "badge_network.h"
#include "badge_types.h"
#include "board_config.h"

namespace {
BadgeAudio audio;
BadgeDisplay badgeDisplay;
BadgeNetwork network;
BadgeState currentState = BadgeState::Boot;
uint32_t stateEnteredMs = 0;
uint32_t lastTelemetryMs = 0;
uint32_t lastButtonChangeMs = 0;
bool rawButtonPressed = false;
bool stableButtonPressed = false;
float batteryVoltage = NAN;
String serialCommand;

float readBatteryVoltage() {
  digitalWrite(BAT_VOLT_PIN_EN, HIGH);
  delay(2);

  uint32_t totalMillivolts = 0;
  for (size_t sample = 0; sample < BadgeConfig::kBatterySamples; ++sample) {
    totalMillivolts += analogReadMilliVolts(BAT_VOLT_PIN);
  }

  digitalWrite(BAT_VOLT_PIN_EN, LOW);
  return 2.0F * static_cast<float>(totalMillivolts) /
         static_cast<float>(BadgeConfig::kBatterySamples) / 1000.0F;
}

void printBoardIdentity() {
  Serial.printf(
      "{\"event\":\"BOOT\",\"firmware\":\"morgan-badge\","
      "\"version\":\"%s\","
      "\"chip\":\"%s\",\"revision\":%u,\"cpuMHz\":%u,"
      "\"flashBytes\":%u,\"psramBytes\":%u}\n",
      BadgeConfig::kFirmwareVersion, ESP.getChipModel(), ESP.getChipRevision(), ESP.getCpuFreqMHz(),
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
  const bool stateChanged = currentState != nextState;
  if (stateChanged) {
    currentState = nextState;
    stateEnteredMs = millis();
    digitalWrite(LED_BUILTIN,
                 nextState == BadgeState::Standby ? HIGH : LOW);
  }
  badgeDisplay.render(currentState, network.cloudConnected(), batteryVoltage, reason);
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
  } else if (command == "diag") {
    printBoardIdentity();
    printPowerStatus();
    network.printDiagnostics();
  } else if (command == "wifi") {
    network.printDiagnostics();
  } else if (command.length()) {
    Serial.println(
        "{\"event\":\"ERROR\",\"message\":\"Unknown command; use standby, listen, think, speak, voice, cancel, wifi, or diag\"}");
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
  digitalWrite(LED_BUILTIN, HIGH);

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
  badgeDisplay.begin();
  badgeDisplay.render(BadgeState::Boot, false, batteryVoltage,
                      "Hardware self-test");

  const bool audioReady = audio.begin();
  Serial.printf(
      "{\"event\":\"SELFTEST\",\"displayBus\":\"configured-no-readback\","
      "\"audioBus\":\"%s\",\"externalModules\":\"not-detectable-until-wired\"}\n",
      audioReady ? "ready" : "failed");
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

  if (nowMs - lastTelemetryMs >= BadgeConfig::kTelemetryIntervalMs) {
    lastTelemetryMs = nowMs;
    printPowerStatus();
  }
}