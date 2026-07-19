# Morgan Badge Component Emulator

This browser test bench emulates the final Rev A badge component contracts and
firmware timing without requiring the display, audio modules, battery, or
optional peripherals to be soldered.

## Coverage

| Component | Emulated behavior |
| --- | --- |
| XIAO ESP32-C5 | 240 MHz identity, 8 MB flash/PSRAM, monotonic uptime, user LED, state machine |
| ST7789 | 240 x 320 portrait framebuffer, Morgan portrait, state/detail/cloud/battery presentation |
| ICS-43434 | Deterministic 24 kHz PCM16 input, level/noise/clipping, left-slot and clock faults |
| MAX98357A | Shutdown state, gain, PCM RMS, clock/data faults |
| 1511 speaker | Differential-output contract, audible test tone, open/short faults |
| PTT | D0/GPIO1 active-low press/release with 35 ms debounce and local/cloud paths |
| LiPo + SGM40567 | USB charging, state-of-charge, voltage sag, state-dependent load, brownout/charger faults |
| Wi-Fi/TLS/cloud | RSSI, association, NTP, pinned-CA, auth, API and Voice Live readiness |
| PN532 | Authorized/denied tap, access/alert overlay and haptic trigger |
| MPU6050 | Pitch/roll controls and 35-degree motion interrupt |
| DRV2605L | Click, ramp and triple-pulse patterns with browser vibration where available |

The full validation exercises twelve component groups. The fault matrix injects
and verifies all twenty-four exposed failure controls.

## Run

Build and start Morgan:

```powershell
npm run build
npm start
```

Open `http://localhost:3978/badge-emulator` using the configured app port.

The top-level **Run validation** button checks the current configuration. **Run
fault matrix** temporarily injects faults and verifies that each intended
detector fails closed. Hold the badge side switch or Space to exercise PTT.

## Automated Tests

```powershell
npm run test:badge-emulator
```

The tests cover the exact Rev A pin map, baseline components, cloud and local PTT
timings, PCM generation, battery/charger behavior, optional peripherals,
telemetry shape, and the complete fault matrix.

## Boundary

This is a digital behavioral emulator. It cannot establish:

- Correct real-world voltages, rise times, decoupling, current draw, or EMC.
- Wi-Fi antenna performance or RF coexistence.
- Microphone sensitivity, noise floor, acoustic echo, or enclosure effects.
- Amplifier distortion, speaker impedance/polarity, or sound pressure.
- Charger temperature, LiPo protection, actual capacity, or runtime.
- Solder quality, shorts, intermittent joints, or mechanical reliability.

Those require the staged physical bring-up in `hardware/README.md` and the
handover checklist in `docs/morgan-smart-badge-handover.md`.
