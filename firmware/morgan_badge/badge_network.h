#pragma once

#include <Arduino.h>
#include <ArduinoWebsockets.h>

#include <functional>

#include "badge_audio.h"
#include "badge_types.h"

class BadgeNetwork {
 public:
  using StateHandler = std::function<void(BadgeState, const char*)>;
  using StatusHandler = std::function<void(const char*)>;

  void begin(BadgeAudio* audio,
             StateHandler stateHandler,
             StatusHandler statusHandler);
  void loop(BadgeState state, float batteryVoltage);
  bool cloudConnected() const;
  bool voiceReady() const;
  bool voiceConnected() const;
  bool startVoice();
  void cancelVoice();
  void sendMicrophone(const int16_t* samples, size_t sampleCount);
  void finishVoiceInput();
  void printDiagnostics() const;

  // Scans for access points and reports whether the configured SSID is
  // visible, without ever printing the SSID itself. This is what separates
  // "radio cannot see the AP" from "AP is visible but the join fails".
  void printScan() const;

 private:
  BadgeAudio* audio_ = nullptr;
  StateHandler stateHandler_;
  StatusHandler statusHandler_;
  websockets::WebsocketsClient voiceSocket_;
  String deviceId_;
  String authorizationHeader_;
  String extraHeaders_;
  String latestStatusText_ = "Local prototype mode";
  uint32_t wifiAttemptStartedMs_ = 0;
  uint32_t lastWifiAttemptMs_ = 0;
  uint32_t lastStatusPollMs_ = 0;
  uint32_t lastTelemetryMs_ = 0;
  uint32_t voiceStartedMs_ = 0;
  uint32_t clockSyncStartedMs_ = 0;
  bool clockReady_ = false;
  bool clockSyncStarted_ = false;
  bool statusAuthenticated_ = false;
  bool voiceConfigured_ = false;
  bool voiceConnecting_ = false;
  bool voiceConnected_ = false;
  bool awaitingVoiceResponse_ = false;
  bool intentionalVoiceClose_ = false;

  bool configurationPresent() const;
  void connectWifi(uint32_t nowMs);
  void refreshClock();
  void pollStatus();
  void postTelemetry(BadgeState state, float batteryVoltage);
  void handleVoiceMessage(websockets::WebsocketsMessage message);
  void handleVoiceEvent(websockets::WebsocketsEvent event, String data);
  void closeVoice();
};
