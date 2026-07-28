# Morgan Badge Firmware

For the consolidated architecture, deployment, validation, risk, and next-owner
record, see `../docs/morgan-smart-badge-handover.md`.

Before soldering, use the deterministic component test bench documented at
`../src/badge-emulator/README.md` and served from `/badge-emulator`.

The `morgan_badge` sketch targets the Seeed Studio XIAO ESP32-C5 and implements
the Rev A.1 Morgan Smart ID Badge core:

- 240 x 320 ST7789 portrait UI with a cached Morgan RGB565 portrait.
- `STANDBY -> LISTENING -> THINKING -> SPEAKING` state machine.
- Push-to-talk on `D0`.
- Full-duplex I2S clocks with separate microphone input and amplifier output.
- Wi-Fi status polling and device telemetry over CA-validated HTTPS.
- Tool-free Azure Voice Live audio over authenticated, CA-validated WSS.
- Local state/tone fallback when cloud voice is unavailable.
- Optional PN532, MPU6050 and DRV2605L on a rear-pad I2C bus.
- A hardware abstraction layer that runs the same code whether a component is
  soldered, simulated on the MCU, or absent.
- An on-device self-test that reports per-component evidence as JSON.

## Pin Contract (Rev A.1)

`board_config.h` is the single source of truth and enforces the strapping rule
with `static_assert`. On the ESP32-C5 the strapping pins are **GPIO2, GPIO7,
GPIO25, GPIO27 and GPIO28**. Of the front pads only `D2` (GPIO25) and `D3`
(GPIO7) are strapping pins, so they carry display control lines that drive a
high-impedance module input and have **no external pull resistor**. The chip has
~45k internal pulls, so an external 100k resistor would not reliably win at
reset.

| Pad | GPIO | Net | Note |
| --- | --- | --- | --- |
| `D0` | 1 | `PTT_N` | Switch to GND, internal pull-up |
| `D1` | 0 | `AMP_SD` | Carries the external 100k pull-down |
| `D2` | 25 | `LCD_DC` | Strapping pin, no external pull |
| `D3` | 7 | `LCD_CS` | Strapping pin, no external pull |
| `D4` | 23 | `MIC_SD` | ICS-43434 data in |
| `D5` | 24 | `I2S_LRCLK` | Shared word select |
| `D6` | 11 | `I2S_BCLK` | Shared bit clock |
| `D7` | 12 | `AMP_DIN` | MAX98357A data in |
| `D8` | 8 | `LCD_SCK` | Display clock |
| `D9` | 9 | `LCD_SDO` | Optional readback for panel detection |
| `D10` | 10 | `LCD_MOSI` | Display data |
| `MTDI` rear | 3 | `I2C_SCL` | Optional Rev B bus |
| `MTCK` rear | 4 | `I2C_SDA` | Optional Rev B bus |
| `MTDO` rear | 5 | `LCD_RST` | Software panel recovery |
| `MTMS` rear | 2 | reserved | Strapping pin, leave unconnected |

Using the rear pads costs external JTAG debug only. USB flashing and the serial
console run on the USB Serial/JTAG controller (GPIO13/GPIO14) and are unaffected.

## Toolchain

The prototype was built and flashed with:

- Arduino CLI 1.5.1
- Espressif `esp32:esp32` core 3.3.5
- Adafruit ST7735 and ST7789 Library 1.11.0
- Adafruit GFX Library 1.12.6
- ArduinoJson 7.4.3
- ArduinoWebsockets 0.5.4

Install the core and libraries:

```powershell
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@3.3.5
arduino-cli lib install "Adafruit ST7735 and ST7789 Library@1.11.0"
arduino-cli lib install "ArduinoJson@7.4.3"
arduino-cli lib install "ArduinoWebsockets@0.5.4"
```

Do not omit `PSRAM=enabled`. The board menu defaults PSRAM to disabled even
though this XIAO has 8 MB fitted.

## Sample Rate Risk

`kAudioSampleRate` is 24 kHz because Azure Voice Live speaks 24 kHz mono PCM16,
which avoids on-device resampling. The measured I2S clock is accurate to 0.003 %
at that rate, but that only proves the **MCU** generates the clock correctly. It
says nothing about the external parts, which are not fitted yet.

The open risk is the ICS-43434's normal-mode sample-rate floor, which sits near
23 kHz; 24 kHz is only a few percent above it. This was not confirmed from the
datasheet and must be checked before ordering.

If the microphone misbehaves at 24 kHz, the remedy needs **no board change**:
run I2S at 48 kHz and decimate by two on capture, interpolating by two on
playback. Same pins, same parts, same resistors. The sample rate is therefore
not a soldering decision.

## Local Configuration

Run the secure setup helper from the repository root:

```powershell
.\scripts\configure-badge.ps1
```

Enter the SSID and masked Wi-Fi password directly in the terminal. The helper
creates:

- `firmware/morgan_badge/secrets.h`
- `.env.badge.local`

Both are gitignored. The generated badge key is at least 32 bytes and must be set
as the App Service `MORGAN_BADGE_API_KEY` setting. Never paste the Wi-Fi password
or badge key into source, chat, logs, or command output.

## Avatar Asset

Regenerate the display bitmap after changing the source portrait:

```powershell
.\scripts\prepare-badge-avatar.ps1
```

This center-crops `firmware/assets/morgan-portrait.png` to 168 x 168 and writes
`morgan_badge/morgan_avatar_rgb565.h`. The generated array contains 28,224
RGB565 pixels and occupies about 56 KB in firmware flash.

## Build And Flash

```powershell
arduino-cli compile `
  --fqbn "esp32:esp32:XIAO_ESP32C5:PSRAM=enabled,CDCOnBoot=cdc,PartitionScheme=default_8MB" `
  firmware\morgan_badge

arduino-cli upload `
  --port COM7 `
  --fqbn "esp32:esp32:XIAO_ESP32C5:PSRAM=enabled,CDCOnBoot=cdc,PartitionScheme=default_8MB" `
  firmware\morgan_badge

arduino-cli monitor --port COM7 --config baudrate=115200
```

Always pass the full FQBN. Two menu options are load-bearing:

- `PSRAM=enabled`. The board menu defaults PSRAM to disabled even though this
  XIAO has 8 MB fitted, and the 153,600-byte framebuffer will not allocate
  without it.
- `CDCOnBoot=cdc`. With `CDCOnBoot=default` the console falls back to UART0 on
  **GPIO11 and GPIO12**, which are `I2S_BCLK` and `AMP_DIN`. Every serial print
  would then be driven straight into the amplifier data line and the I2S clock.
- `PartitionScheme=default_8MB` gives a 3 MB app partition. The `default` 4 MB
  scheme leaves only 1.2 MB and will not fit this sketch.

The COM port can change after reset. Use `arduino-cli board list` or Windows
Device Manager to identify the Espressif USB Serial/JTAG device.

## Pre-Solder Self-Test

The badge can exercise and report on every component before anything is
soldered. Simulated components are always reported separately from real ones.

```powershell
# Bare board: real MCU checks only, unfitted parts are skipped
./scripts/run-badge-selftest.ps1 -Port COM7

# Bench run: simulate the unsoldered components end to end
./scripts/run-badge-selftest.ps1 -Port COM7 -EnableSimulation

# Solder gate: fails if anything is still simulated
./scripts/run-badge-selftest.ps1 -Port COM7 -Gate PreSolder

# After soldering: requires genuine hardware passes
./scripts/run-badge-selftest.ps1 -Port COM7 -Gate PostSolder
```

Each result carries a mode (`real`, `simulated`, `absent`) and the evidence that
was measured. Verdicts use distinct tokens (`HW-PASS`, `SIM-PASS`, `FAIL`,
`SKIPPED`) and are never merged into a single pass count, so a bench run cannot
be presented as electrical verification. Results are written to `verification/`.

### What actually distinguishes a soldered board

Most checks pass on a bare XIAO because they only exercise the MCU. Only two
checks fail closed when the hardware is missing, and they are what make a
post-solder run meaningful:

| Check | Discriminates? | Basis |
| --- | --- | --- |
| `audio.microphone` | Yes | A fitted ICS-43434 dithers around its noise floor. An unconnected `MIC_SD` line measures a 24-bit spread of exactly 0, so any spread above 64 LSB proves live data. |
| `display.panel` | Yes | ST7789 `RDDID` readback, which needs the optional `LCD_SDO` line. |
| `input.ptt` | No | A released switch and a missing switch both read HIGH. Needs the operator step below. |
| `power.batterySense` | No | Reads the USB rail when no cell is fitted. Needs the USB-removed step below. |

`-Gate PostSolder` requires all four to be `HW-PASS`, but only the first two can
catch missing hardware on their own. Two nets cannot be proven without a human:

- **PTT continuity.** Run the `pttwait` serial command and physically press the
  switch within 10 seconds. It reports `pressed` and `released`.
- **LiPo path.** Re-run the self-test on battery with USB removed and confirm
  `power.batterySense` leaves the ~4.0 V USB-rail band and tracks the cell.

The speaker is a passive load and is never observable from the MCU. Sound
pressure, polarity, acoustic response, charge thermals, and RF all remain
out of scope for this rig.

## Serial Bench Commands

Commands are newline-terminated and intended for bring-up only:

| Command | Action |
| --- | --- |
| `diag` | Print chip, flash, PSRAM, power, peripheral modes, Wi-Fi, clock, API, and voice readiness. |
| `selftest` | Run the structured pre-solder self-test and emit JSON. |
| `modes` | Print the mode and evidence for every badge component. |
| `scan` | Re-probe the optional I2C bus and reprint modes. |
| `sim all on` / `sim all off` | Enable or disable simulation for unfitted components. |
| `sim <name> on\|off` | Simulate one component, for example `sim microphone on`. |
| `tilt <pitch> <roll>` | Drive the IMU path and report the 35 degree motion interrupt. |
| `tap` / `tap deny` | Drive an authorized or denied NFC tap. |
| `haptic <click\|ramp\|alert>` | Trigger a haptic pattern. |
| `pttwait` | Wait up to 10 s for a physical PTT press and release. |
| `wifi` | Print non-secret network readiness and RSSI. |
| `standby` | Force standby UI. |
| `listen` | Force listening UI without opening the cloud socket. |
| `think` | Exercise local thinking-to-speaking fallback. |
| `speak` | Exercise the local confirmation tone. |
| `voice` | Open the authenticated tool-free WSS session without recording. |
| `cancel` | Cancel and close the current voice session. |

Simulation is refused for any component that has no pin allocation, and it can
be compiled out entirely by building with `BADGE_ALLOW_SIMULATION=0`.

No command prints SSID, password, bearer key, local IP, or endpoint credentials.

## Live Contract

The deployed App Service provides:

- `GET /api/badge/status`: compact identity, next-action, and voice readiness.
- `POST /api/badge/telemetry`: strict, bounded hardware telemetry.
- `WSS /api/badge/voice`: binary PCM16 voice path with no callable tools.

The badge voice session cannot execute Morgan's finance tools. Detailed finance
queries and actions remain on the authenticated Mission Control/Agent surfaces,
where server-side governance and HITL controls apply.

## Verified On The Attached Board

- ESP32-C5 revision 1.0 at 240 MHz.
- 8 MB flash and 8 MB PSRAM.
- Upload hashes verified by esptool.
- Wi-Fi association and NTP clock synchronization.
- Badge API HTTP 200 and telemetry HTTP 202 from the XIAO.
- Authenticated WSS opened, reached `Speak now`, and closed cleanly.
- Offline state cycle completed and returned to standby.

External display, microphone, amplifier, speaker, PTT switch, and LiPo behavior
remain electrically unverified until those parts are soldered. See
`../hardware/README.md` for the net table and safe bring-up sequence.