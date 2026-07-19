# Morgan Badge Firmware

For the consolidated architecture, deployment, validation, risk, and next-owner
record, see `../docs/morgan-smart-badge-handover.md`.

The `morgan_badge` sketch targets the Seeed Studio XIAO ESP32-C5 and implements
the Rev A Morgan Smart ID Badge core:

- 240 x 320 ST7789 portrait UI with a cached Morgan RGB565 portrait.
- `STANDBY -> LISTENING -> THINKING -> SPEAKING` state machine.
- Push-to-talk on `D0`.
- Full-duplex I2S clocks with separate microphone input and amplifier output.
- Wi-Fi status polling and device telemetry over CA-validated HTTPS.
- Tool-free Azure Voice Live audio over authenticated, CA-validated WSS.
- Local state/tone fallback when cloud voice is unavailable.

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
  --fqbn "esp32:esp32:XIAO_ESP32C5:PSRAM=enabled" `
  firmware\morgan_badge

arduino-cli upload `
  --port COM7 `
  --fqbn "esp32:esp32:XIAO_ESP32C5:PSRAM=enabled" `
  firmware\morgan_badge

arduino-cli monitor --port COM7 --config baudrate=115200
```

The COM port can change after reset. Use `arduino-cli board list` or Windows
Device Manager to identify the Espressif USB Serial/JTAG device.

## Serial Bench Commands

Commands are newline-terminated and intended for bring-up only:

| Command | Action |
| --- | --- |
| `diag` | Print chip, flash, PSRAM, power, Wi-Fi, clock, API, and voice readiness. |
| `wifi` | Print non-secret network readiness and RSSI. |
| `standby` | Force standby UI. |
| `listen` | Force listening UI without opening the cloud socket. |
| `think` | Exercise local thinking-to-speaking fallback. |
| `speak` | Exercise the local confirmation tone. |
| `voice` | Open the authenticated tool-free WSS session without recording. |
| `cancel` | Cancel and close the current voice session. |

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