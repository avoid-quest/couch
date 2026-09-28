# Bluetooth

Bluetooth settings work on Linux, where Core calls BlueZ's own
[`bluetoothctl`](https://github.com/bluez/bluez/blob/master/doc/bluetoothctl.rst)
(`src/server/bluetooth-linux.ts`). On macOS and Windows the page reports that
Bluetooth isn't available on this Couch; pair devices in the system settings.

Administrators search for nearby devices in Settings → Bluetooth and pair,
connect, disconnect or forget any listed device. Discovery lasts 30 seconds and
every operation stops within 60 seconds. Cancelling, leaving the page, losing
the connection or losing administrator access stops the pending operation.

Pairing registers a `NoInputNoOutput` agent for that one `bluetoothctl` call, so
BlueZ accepts the Just Works pairing that speakers and headphones use, then
trusts and connects the device. Devices that ask for a PIN or passkey can't pair
from Couch.

Paired, connected and selected for playback are separate states. A connected
output appears in Sound, correlated by the audio card's Bluetooth address. Couch
makes one reconnect attempt for the selected output's address on startup.

The TV setup installs `bluez` and `libspa-0.2-bluetooth` with PipeWire and
WirePlumber; Bluetooth and audio run as the `couch-tv` login.
