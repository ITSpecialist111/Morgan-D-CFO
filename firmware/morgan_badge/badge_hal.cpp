#include "badge_hal.h"

#include <Wire.h>

#include <cstring>

#include "board_config.h"

namespace {
struct PeripheralDescriptor {
  const char* name;
  const char* bus;
  bool pinAllocated;
};

// Every entry here must correspond to a real net in the Rev A.1 pin contract.
// If a component has no pin, it cannot be wired and must not be simulated.
constexpr PeripheralDescriptor kDescriptors[kPeripheralCount] = {
    {"display", "spi", true},        // LCD_CS/DC/SCK/MOSI/RST
    {"microphone", "i2s", true},     // MIC_SD + shared clocks
    {"amplifier", "i2s", true},      // AMP_DIN + AMP_SD
    {"speaker", "analog", true},     // amplifier differential output
    {"ptt", "gpio", true},           // PTT_N
    {"battery", "adc", true},        // on-module divider + load switch
    {"nfc", "i2c", true},            // rear-pad I2C
    {"imu", "i2c", true},            // rear-pad I2C
    {"haptic", "i2c", true},         // rear-pad I2C
};

constexpr const char* kModeNames[] = {"absent", "simulated", "real"};
}  // namespace

void BadgeHal::begin() {
  for (size_t index = 0; index < kPeripheralCount; ++index) {
    modes_[index] = PeripheralMode::Absent;
    std::strncpy(evidence_[index], "not probed", sizeof(evidence_[index]) - 1);
    evidence_[index][sizeof(evidence_[index]) - 1] = '\0';
  }
}

PeripheralMode BadgeHal::mode(Peripheral peripheral) const {
  const size_t index = static_cast<size_t>(peripheral);
  return index < kPeripheralCount ? modes_[index] : PeripheralMode::Absent;
}

const char* BadgeHal::name(Peripheral peripheral) const {
  const size_t index = static_cast<size_t>(peripheral);
  return index < kPeripheralCount ? kDescriptors[index].name : "unknown";
}

const char* BadgeHal::bus(Peripheral peripheral) const {
  const size_t index = static_cast<size_t>(peripheral);
  return index < kPeripheralCount ? kDescriptors[index].bus : "none";
}

const char* BadgeHal::evidence(Peripheral peripheral) const {
  const size_t index = static_cast<size_t>(peripheral);
  return index < kPeripheralCount ? evidence_[index] : "";
}

const char* BadgeHal::modeName(Peripheral peripheral) const {
  return kModeNames[static_cast<size_t>(mode(peripheral))];
}

bool BadgeHal::hasPinAllocation(Peripheral peripheral) const {
  const size_t index = static_cast<size_t>(peripheral);
  return index < kPeripheralCount && kDescriptors[index].pinAllocated;
}

void BadgeHal::setEvidence(Peripheral peripheral, const char* text) {
  const size_t index = static_cast<size_t>(peripheral);
  if (index >= kPeripheralCount) return;
  std::strncpy(evidence_[index], text ? text : "", sizeof(evidence_[index]) - 1);
  evidence_[index][sizeof(evidence_[index]) - 1] = '\0';
}

bool BadgeHal::setSimulated(Peripheral peripheral, bool enabled) {
  const size_t index = static_cast<size_t>(peripheral);
  if (index >= kPeripheralCount) return false;

  if (!enabled) {
    // Disabling simulation must never erase a genuine detection. Only a
    // simulated peripheral returns to Absent.
    if (modes_[index] == PeripheralMode::Real) return true;
    modes_[index] = PeripheralMode::Absent;
    setEvidence(peripheral, "simulation disabled");
    return true;
  }

#if !BADGE_ALLOW_SIMULATION
  setEvidence(peripheral, "simulation compiled out");
  return false;
#else
  // Refusing to simulate a peripheral that has no pin allocation is the check
  // that prevents certifying hardware the badge cannot physically host.
  if (!kDescriptors[index].pinAllocated) {
    setEvidence(peripheral, "refused: no pin allocation");
    return false;
  }
  if (modes_[index] == PeripheralMode::Real) {
    setEvidence(peripheral, "refused: real hardware detected");
    return false;
  }
  modes_[index] = PeripheralMode::Simulated;
  setEvidence(peripheral, "simulated on MCU, not electrically verified");
  return true;
#endif
}

void BadgeHal::setReal(Peripheral peripheral, const char* text) {
  const size_t index = static_cast<size_t>(peripheral);
  if (index >= kPeripheralCount) return;
  modes_[index] = PeripheralMode::Real;
  setEvidence(peripheral, text);
}

void BadgeHal::setAbsent(Peripheral peripheral, const char* text) {
  const size_t index = static_cast<size_t>(peripheral);
  if (index >= kPeripheralCount) return;
  modes_[index] = PeripheralMode::Absent;
  setEvidence(peripheral, text);
}

bool BadgeHal::anySimulated() const {
  return simulatedCount() > 0;
}

size_t BadgeHal::simulatedCount() const {
  size_t total = 0;
  for (size_t index = 0; index < kPeripheralCount; ++index) {
    if (modes_[index] == PeripheralMode::Simulated) ++total;
  }
  return total;
}

size_t BadgeHal::realCount() const {
  size_t total = 0;
  for (size_t index = 0; index < kPeripheralCount; ++index) {
    if (modes_[index] == PeripheralMode::Real) ++total;
  }
  return total;
}

void BadgeHal::probeI2c() {
  Wire.begin(BadgeConfig::kI2cSdaPin, BadgeConfig::kI2cSclPin,
             BadgeConfig::kI2cClockHz);

  struct Probe {
    Peripheral peripheral;
    uint8_t address;
  };
  const Probe probes[] = {
      {Peripheral::Nfc, BadgeConfig::kNfcAddress},
      {Peripheral::Imu, BadgeConfig::kImuAddress},
      {Peripheral::Haptic, BadgeConfig::kHapticAddress},
  };

  size_t acked = 0;
  char detail[56];
  for (const Probe& probe : probes) {
    Wire.beginTransmission(probe.address);
    const uint8_t status = Wire.endTransmission();
    if (status == 0) {
      snprintf(detail, sizeof(detail), "i2c ack at 0x%02X", probe.address);
      setReal(probe.peripheral, detail);
      ++acked;
    } else if (mode(probe.peripheral) != PeripheralMode::Simulated) {
      snprintf(detail, sizeof(detail), "no i2c ack at 0x%02X (err %u)",
               probe.address, status);
      setAbsent(probe.peripheral, detail);
    }
  }
  i2cBusUsable_ = acked > 0;
}

void BadgeHal::printModes(Print& out) const {
  out.print("{\"event\":\"HAL\",\"pinContractRev\":");
  out.print(BadgeConfig::kPinContractRevision);
  out.print(",\"simulationBuild\":");
  out.print(BADGE_ALLOW_SIMULATION ? "true" : "false");
  out.print(",\"peripherals\":{");
  for (size_t index = 0; index < kPeripheralCount; ++index) {
    const Peripheral peripheral = static_cast<Peripheral>(index);
    if (index) out.print(',');
    out.print('"');
    out.print(kDescriptors[index].name);
    out.print("\":{\"mode\":\"");
    out.print(modeName(peripheral));
    out.print("\",\"bus\":\"");
    out.print(kDescriptors[index].bus);
    out.print("\",\"evidence\":\"");
    out.print(evidence_[index]);
    out.print("\"}");
  }
  out.print("},\"simulated\":");
  out.print(simulatedCount());
  out.print(",\"real\":");
  out.print(realCount());
  out.println("}");
}
