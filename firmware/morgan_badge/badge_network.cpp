#include "badge_network.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>

#include "board_config.h"
#include "tls_root.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define MORGAN_BADGE_HAS_SECRETS 1
#else
#define MORGAN_BADGE_HAS_SECRETS 0
namespace BadgeSecrets {
constexpr char kWifiSsid[] = "";
constexpr char kWifiPassword[] = "";
constexpr char kApiHost[] = "";
constexpr uint16_t kApiPort = 443;
constexpr char kApiKey[] = "";
}  // namespace BadgeSecrets
#endif

namespace {
constexpr uint32_t kWifiConnectTimeoutMs = 20000;
constexpr uint32_t kWifiRetryIntervalMs = 30000;
constexpr uint32_t kStatusPollIntervalMs = 15000;
constexpr uint32_t kTelemetryIntervalMs = 30000;
constexpr uint32_t kVoiceResponseTimeoutMs = 30000;
constexpr uint32_t kClockSyncRetryMs = 15000;
constexpr time_t kMinimumValidTime = 1704067200;

String httpsUrl(const char* path) {
  String url = "https://";
  url += BadgeSecrets::kApiHost;
  if (BadgeSecrets::kApiPort != 443) {
    url += ':';
    url += BadgeSecrets::kApiPort;
  }
  url += path;
  return url;
}

String stateName(BadgeState state) {
  return String(badgeStateName(state));
}
}  // namespace

void BadgeNetwork::begin(BadgeAudio* audio,
                         StateHandler stateHandler,
                         StatusHandler statusHandler) {
  audio_ = audio;
  stateHandler_ = std::move(stateHandler);
  statusHandler_ = std::move(statusHandler);

  const uint64_t chipId = ESP.getEfuseMac();
  char deviceId[32];
  snprintf(deviceId, sizeof(deviceId), "morgan-c5-%08lx",
           static_cast<unsigned long>(chipId & 0xFFFFFFFF));
  deviceId_ = deviceId;
  authorizationHeader_ = "Bearer ";
  authorizationHeader_ += BadgeSecrets::kApiKey;
  voiceSocket_.setCACert(kMorganTlsRoot);
  voiceSocket_.addHeader("Authorization", authorizationHeader_);
  voiceSocket_.addHeader("X-Morgan-Badge-Id", deviceId_);
  voiceSocket_.onMessage([this](websockets::WebsocketsMessage message) {
    handleVoiceMessage(std::move(message));
  });
  voiceSocket_.onEvent(
      [this](websockets::WebsocketsEvent event, String data) {
        handleVoiceEvent(event, data);
      });

  if (!configurationPresent()) {
    Serial.println(
        "{\"event\":\"NET\",\"status\":\"local-only\",\"reason\":\"secrets.h missing or incomplete\"}");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setHostname("morgan-badge");
  connectWifi(millis());
}

void BadgeNetwork::loop(BadgeState state, float batteryVoltage) {
  const uint32_t nowMs = millis();
  if (!configurationPresent()) return;

  if (WiFi.status() != WL_CONNECTED) {
    statusAuthenticated_ = false;
    voiceConfigured_ = false;
    clockReady_ = false;
    clockSyncStarted_ = false;
    clockSyncStartedMs_ = 0;
    if (wifiAttemptStartedMs_ != 0 &&
        nowMs - wifiAttemptStartedMs_ >= kWifiConnectTimeoutMs) {
      WiFi.disconnect();
      wifiAttemptStartedMs_ = 0;
      Serial.println(
          "{\"event\":\"NET\",\"status\":\"wifi-timeout\"}");
    }
    if (wifiAttemptStartedMs_ == 0 &&
        nowMs - lastWifiAttemptMs_ >= kWifiRetryIntervalMs) {
      connectWifi(nowMs);
    }
    return;
  }

  if (!clockReady_) refreshClock();
  if (!clockReady_) return;

  const bool voiceActive = voiceConnecting_ || voiceConnected_ || awaitingVoiceResponse_;
  if (voiceActive && voiceSocket_.available()) voiceSocket_.poll();

  if (!voiceActive &&
      (lastStatusPollMs_ == 0 || nowMs - lastStatusPollMs_ >= kStatusPollIntervalMs)) {
    pollStatus();
    lastStatusPollMs_ = nowMs;
  }

  if (statusAuthenticated_ && !voiceActive &&
      (lastTelemetryMs_ == 0 || nowMs - lastTelemetryMs_ >= kTelemetryIntervalMs)) {
    postTelemetry(state, batteryVoltage);
    lastTelemetryMs_ = nowMs;
  }

  if (voiceActive &&
      nowMs - voiceStartedMs_ >= kVoiceResponseTimeoutMs) {
    closeVoice();
    if (stateHandler_) stateHandler_(BadgeState::Standby, "Voice response timed out");
  }
}

bool BadgeNetwork::cloudConnected() const {
  return WiFi.status() == WL_CONNECTED && clockReady_ && statusAuthenticated_;
}

bool BadgeNetwork::voiceReady() const {
  return cloudConnected() && voiceConfigured_;
}

bool BadgeNetwork::voiceConnected() const {
  return voiceConnected_;
}

bool BadgeNetwork::startVoice() {
  if (!voiceReady() || voiceConnected_ || awaitingVoiceResponse_) return false;

  intentionalVoiceClose_ = false;
  voiceConnecting_ = true;
  voiceStartedMs_ = millis();
  if (stateHandler_) stateHandler_(BadgeState::Listening, "Connecting voice");

  String url = "wss://";
  url += BadgeSecrets::kApiHost;
  if (BadgeSecrets::kApiPort != 443) {
    url += ':';
    url += BadgeSecrets::kApiPort;
  }
  url += "/api/badge/voice";

  if (!voiceSocket_.connect(url)) {
    voiceConnecting_ = false;
    Serial.println("{\"event\":\"NET\",\"status\":\"voice-connect-failed\"}");
    if (stateHandler_) stateHandler_(BadgeState::Standby, "Voice connection failed");
    return false;
  }
  return voiceConnected_;
}

void BadgeNetwork::cancelVoice() {
  if (voiceConnected_) {
    String cancel = "{\"type\":\"response.cancel\"}";
    voiceSocket_.send(cancel);
  }
  closeVoice();
  if (audio_) audio_->stopPlayback();
  if (stateHandler_) stateHandler_(BadgeState::Standby, "Voice cancelled");
}

void BadgeNetwork::sendMicrophone(const int16_t* samples, size_t sampleCount) {
  if (!voiceConnected_ || awaitingVoiceResponse_ || !samples || sampleCount == 0) return;
  voiceSocket_.sendBinary(reinterpret_cast<const char*>(samples),
                          sampleCount * sizeof(int16_t));
}

void BadgeNetwork::finishVoiceInput() {
  if (!voiceConnected_ || awaitingVoiceResponse_) return;
  String commit = "{\"type\":\"input_audio_buffer.commit\"}";
  String respond = "{\"type\":\"response.create\"}";
  voiceSocket_.send(commit);
  voiceSocket_.send(respond);
  awaitingVoiceResponse_ = true;
  voiceStartedMs_ = millis();
  if (stateHandler_) stateHandler_(BadgeState::Thinking, "Morgan is thinking");
}

void BadgeNetwork::printDiagnostics() const {
  Serial.printf(
      "{\"event\":\"NET\",\"wifi\":\"%s\",\"clock\":\"%s\","
      "\"apiAuthenticated\":%s,\"voiceConfigured\":%s,\"rssiDbm\":%d}\n",
      WiFi.status() == WL_CONNECTED ? "connected" : "disconnected",
      clockReady_ ? "synchronized" : "pending",
      statusAuthenticated_ ? "true" : "false",
      voiceConfigured_ ? "true" : "false",
      WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
}

bool BadgeNetwork::configurationPresent() const {
  return MORGAN_BADGE_HAS_SECRETS &&
         strlen(BadgeSecrets::kWifiSsid) > 0 &&
         strlen(BadgeSecrets::kWifiPassword) > 0 &&
         strlen(BadgeSecrets::kApiHost) > 0 &&
         strlen(BadgeSecrets::kApiKey) >= 32;
}

void BadgeNetwork::connectWifi(uint32_t nowMs) {
  lastWifiAttemptMs_ = nowMs;
  wifiAttemptStartedMs_ = nowMs == 0 ? 1 : nowMs;
  WiFi.begin(BadgeSecrets::kWifiSsid, BadgeSecrets::kWifiPassword);
  Serial.println("{\"event\":\"NET\",\"status\":\"wifi-connecting\"}");
}

void BadgeNetwork::refreshClock() {
  if (time(nullptr) >= kMinimumValidTime) {
    clockReady_ = true;
    clockSyncStarted_ = false;
    wifiAttemptStartedMs_ = 0;
    Serial.printf(
        "{\"event\":\"NET\",\"status\":\"wifi-ready\",\"rssiDbm\":%d}\n",
        WiFi.RSSI());
    return;
  }

  const uint32_t nowMs = millis();
  if (clockSyncStarted_ && nowMs - clockSyncStartedMs_ < kClockSyncRetryMs) {
    return;
  }

  configTime(0, 0, "time.cloudflare.com", "pool.ntp.org");
  clockSyncStarted_ = true;
  clockSyncStartedMs_ = nowMs;
  Serial.println("{\"event\":\"NET\",\"status\":\"clock-syncing\"}");
}

void BadgeNetwork::pollStatus() {
  NetworkClientSecure secureClient;
  secureClient.setCACert(kMorganTlsRoot);
  HTTPClient request;
  request.setConnectTimeout(5000);
  request.setTimeout(7000);

  const String url = httpsUrl("/api/badge/status");
  if (!request.begin(secureClient, url)) {
    Serial.println("{\"event\":\"NET\",\"status\":\"status-begin-failed\"}");
    return;
  }
  request.addHeader("Authorization", authorizationHeader_);
  request.addHeader("X-Morgan-Badge-Id", deviceId_);
  const int responseCode = request.GET();
  statusAuthenticated_ = responseCode == HTTP_CODE_OK;
  voiceConfigured_ = false;

  if (responseCode == HTTP_CODE_OK) {
    JsonDocument document;
    const DeserializationError error = deserializeJson(document, request.getStream());
    if (!error) {
      latestStatusText_ = document["presentation"]["statusText"] | "Morgan is ready";
      voiceConfigured_ = document["voice"]["configured"] | false;
      if (statusHandler_) statusHandler_(latestStatusText_.c_str());
    } else {
      statusAuthenticated_ = false;
    }
  }

  Serial.printf(
      "{\"event\":\"NET\",\"status\":\"badge-api\",\"httpCode\":%d,"
      "\"authenticated\":%s,\"voiceConfigured\":%s}\n",
      responseCode,
      statusAuthenticated_ ? "true" : "false",
      voiceConfigured_ ? "true" : "false");
  request.end();
}

void BadgeNetwork::postTelemetry(BadgeState state, float batteryVoltage) {
  JsonDocument document;
  document["deviceId"] = deviceId_;
  document["firmwareVersion"] = BadgeConfig::kFirmwareVersion;
  document["state"] = stateName(state);
  document["batteryVolts"] = batteryVoltage;
  document["batteryPresence"] = "unverified";
  document["rssiDbm"] = WiFi.RSSI();
  document["freeHeapBytes"] = ESP.getFreeHeap();
  document["psramBytes"] = ESP.getPsramSize();
  document["peripherals"]["display"] = "configured-no-readback";
  document["peripherals"]["microphone"] = "unverified";
  document["peripherals"]["amplifier"] = "unverified";

  String payload;
  serializeJson(document, payload);

  NetworkClientSecure secureClient;
  secureClient.setCACert(kMorganTlsRoot);
  HTTPClient request;
  request.setConnectTimeout(5000);
  request.setTimeout(7000);
  if (!request.begin(secureClient, httpsUrl("/api/badge/telemetry"))) return;
  request.addHeader("Authorization", authorizationHeader_);
  request.addHeader("X-Morgan-Badge-Id", deviceId_);
  request.addHeader("Content-Type", "application/json");
  const int responseCode = request.POST(payload);
  Serial.printf(
      "{\"event\":\"NET\",\"status\":\"telemetry\",\"httpCode\":%d}\n",
      responseCode);
  request.end();
}

void BadgeNetwork::handleVoiceMessage(websockets::WebsocketsMessage message) {
  if (message.isBinary()) {
    if (audio_ && message.length() >= sizeof(int16_t)) {
      awaitingVoiceResponse_ = true;
      if (stateHandler_) stateHandler_(BadgeState::Speaking, "Morgan is speaking");
      audio_->playPcm16(
          reinterpret_cast<const int16_t*>(message.c_str()),
          message.length() / sizeof(int16_t));
    }
    return;
  }

  if (!message.isText()) return;
  JsonDocument document;
  if (deserializeJson(document, message.c_str(), message.length())) return;
  const String eventType = document["type"] | "";
  if (eventType == "response.audio.done" || eventType == "response.done") {
    if (audio_) audio_->stopPlayback();
    closeVoice();
    if (stateHandler_) stateHandler_(BadgeState::Standby, "Ready");
  } else if (eventType == "error") {
    if (audio_) audio_->stopPlayback();
    closeVoice();
    if (stateHandler_) stateHandler_(BadgeState::Standby, "Voice unavailable");
  }
}

void BadgeNetwork::handleVoiceEvent(websockets::WebsocketsEvent event,
                                    String data) {
  switch (event) {
    case websockets::WebsocketsEvent::ConnectionOpened:
      voiceConnecting_ = false;
      voiceConnected_ = true;
      awaitingVoiceResponse_ = false;
      Serial.println("{\"event\":\"NET\",\"status\":\"voice-connected\"}");
      if (stateHandler_) stateHandler_(BadgeState::Listening, "Speak now");
      break;
    case websockets::WebsocketsEvent::ConnectionClosed: {
      const bool notify = (voiceConnected_ || awaitingVoiceResponse_) &&
                          !intentionalVoiceClose_;
      data.replace("\"", "'");
      if (data.length() > 80) {
        data = data.substring(0, 80);
      }
      Serial.printf(
          "{\"event\":\"NET\",\"status\":\"voice-disconnected\","
          "\"intentional\":%s,\"reason\":\"%s\"}\n",
          intentionalVoiceClose_ ? "true" : "false",
          data.c_str());
      voiceConnected_ = false;
      voiceConnecting_ = false;
      awaitingVoiceResponse_ = false;
      if (audio_) audio_->stopPlayback();
      if (notify && stateHandler_) {
        stateHandler_(BadgeState::Standby, "Voice disconnected");
      }
      intentionalVoiceClose_ = false;
      break;
    }
    default:
      break;
  }
}

void BadgeNetwork::closeVoice() {
  intentionalVoiceClose_ = true;
  voiceConnecting_ = false;
  voiceConnected_ = false;
  awaitingVoiceResponse_ = false;
  voiceSocket_.close();
}
