# Morgan Smart ID Badge Rev A

For the consolidated architecture, deployment, validation, risk, and next-owner
record, see `../docs/morgan-smart-badge-handover.md`.

Use `/badge-emulator` to exercise digital component behavior and injected faults
before following the physical solder and measurement sequence below.

This directory contains the build package for the first physical Morgan badge
prototype:

- `morgan-badge-rev-a.svg`: rendered module-level engineering schematic.
- `morgan-badge-rev-a-wiring.csv`: exact point-to-point net table.
- `../firmware/morgan_badge/`: flashed XIAO ESP32-C5 firmware.

The schematic is intentionally module-level. The exact ST7789 and MAX98357A
breakout variants have not been identified from manufacturer part numbers, so
Rev A connects the named module pins and adds the external protection and
decoupling required for the direct-wire prototype. Confirm every silkscreen label
against the module in hand before soldering.

## Critical Corrections

The initial concept joined microphone and amplifier data on one I2S wire. That
cannot work: the microphone drives data into the ESP32 and the ESP32 drives data
out to the amplifier. Rev A therefore uses:

| Signal | XIAO pad | Direction |
| --- | --- | --- |
| Microphone SD | `D4 / GPIO23` | ICS-43434 to ESP32-C5 |
| Amplifier DIN | `D7 / GPIO12` | ESP32-C5 to MAX98357A |
| I2S LRCLK | `D5 / GPIO24` | ESP32-C5 to both audio modules |
| I2S BCLK | `D6 / GPIO11` | ESP32-C5 to both audio modules |

The MAX98357A is powered from `VBAT_RAW`, not the XIAO `3V3` output. Speaker
current must not pass through the XIAO 3.3 V regulator. `SPK+` and `SPK-` are a
differential Class-D pair; neither speaker lead connects to ground.

## Rev A Bill Of Materials

| Ref | Part | Value / requirement |
| --- | --- | --- |
| U1 | Seeed Studio XIAO ESP32-C5 | 8 MB flash / 8 MB PSRAM |
| U2 | ST7789 SPI display module | 2.0 inch, assumed 240 x 320, 3.3 V logic |
| U3 | ICS-43434 I2S microphone module | 3.3 V |
| U4 | MAX98357A I2S amplifier module | 2.5-5.5 V; powered from battery rail |
| SPK1 | 1511 dynamic speaker | Verify marking; schematic assumes 8 ohm, 0.5-1 W |
| BT1 | 303040 LiPo | Protected 3.7 V cell; verify connector/pad polarity |
| SW1 | Momentary push button | Normally open PTT switch |
| R1-R4, R7-R8 | Resistor | 22 ohm signal damping |
| R5 | Resistor | 1 kohm amplifier shutdown input series |
| R6 | Resistor | 100 kohm amplifier shutdown pull-down |
| R9 | Resistor | 10 kohm display reset pull-up |
| C1, C3-C5 | Ceramic capacitor | 100 nF, X7R |
| C2 | Ceramic capacitor | 10 uF, 6.3 V or higher |
| C6 | Low-ESR capacitor | 100 uF, 6.3 V or higher, close to amplifier |
| Wire | Insulated wire | 30 AWG for signals; use heavier wire for battery and speaker |

The ST7789 `BL` pin is tied to 3.3 V in Rev A. This is appropriate only for a
breakout with a backlight resistor/driver. If the purchased display exposes a raw
LED anode/cathode instead, stop and add a transistor current driver before power.

## Safe Solder Order

1. Disconnect USB and battery. Photograph both sides of every module and verify
   labels, display resolution, speaker impedance, and battery polarity.
2. Attach the XIAO U.FL antenna. The tested loose-board signal ranged from roughly
   -73 to -87 dBm; reliable realtime audio needs the antenna seated and clear of
   the battery, display flex, and speaker wiring.
3. Solder ground and power wiring only. Inspect under magnification and verify
   resistance from `3V3` to `GND` and `VBAT_RAW` to `GND` is not near zero.
4. Add the ST7789 and its local capacitors. Power by USB only and verify the Morgan
   screen before adding audio.
5. Add ICS-43434, the 22 ohm clock/data resistors, and its 100 nF capacitor. Keep
   the microphone port unobstructed and away from the speaker.
6. Add MAX98357A and its 100 nF + 100 uF capacitors. Leave the speaker disconnected
   until the amplifier supply and shutdown state have been measured.
7. Connect the speaker last. Twist `SPK+` with `SPK-`, start at low software gain,
   and confirm neither lead is shorted to ground.
8. Add the PTT switch between `D0` and `GND`.
9. Re-run USB tests. Only then solder the LiPo to the XIAO battery pads with USB
   unplugged. Insulate both joints before moving the cell.

Use a current-limited bench supply when available. Do not solder directly to an
unprotected or swollen LiPo cell, and do not work on battery wiring while the
cell is connected.

## Optional V1 Peripherals

PN532, MPU6050, and DRV2605L are not on the Rev A core schematic. All eleven
front XIAO pads are assigned. Adding those modules would require a daughterboard
using the rear JTAG pads for I2C and interrupts, which sacrifices debug access and
conflicts with Seeed's guidance to reserve those pads during deep-sleep bring-up.
Build and validate the display/audio/PTT core first, then design Rev B around the
actual optional module dimensions and interrupt requirements.

## What Has Been Verified

On the attached XIAO ESP32-C5, before soldering external modules:

- ROM identity: ESP32-C5 revision 1.0, 240 MHz.
- Flash and PSRAM: 8 MB each with `PSRAM=enabled`.
- Firmware compile, upload, hash verification, and USB serial diagnostics.
- `STANDBY -> LISTENING -> THINKING -> SPEAKING -> STANDBY` state transitions.
- Wi-Fi association and NTP synchronization.
- CA-validated HTTPS to the deployed Morgan App Service.
- Authenticated badge status HTTP 200 and telemetry HTTP 202.
- Authenticated, tool-free badge Voice Live WebSocket connection and clean close.

The display pixels, microphone signal quality, amplifier output, speaker polarity,
PTT switch, and battery charging path cannot be electrically tested until those
parts are soldered. Bus initialization is not proof that an unwired peripheral is
present.