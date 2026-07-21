#pragma once

#include <Arduino.h>

enum class BadgeState : uint8_t {
  Boot,
  Standby,
  Listening,
  Thinking,
  Speaking,
  Fault,
};

const char* badgeStateName(BadgeState state);
