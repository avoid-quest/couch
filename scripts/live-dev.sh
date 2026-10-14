#!/usr/bin/env bash
# Runs the built Core with a temporary authenticated TURN TCP relay, so other
# devices on the LAN can test live inputs (docs/live-inputs.md). It stays in the
# foreground and stops both on exit, Ctrl-C or `kill "$(cat "$COUCH_DATA_DIR/live-dev.pid")"`.
set -euo pipefail

address=${1:?Usage: COUCH_DATA_DIR=<scratch dir> COUCH_PORT=<port> scripts/live-dev.sh <this machine LAN IPv4>}
: "${COUCH_DATA_DIR:?Set COUCH_DATA_DIR to a scratch directory}" "${COUCH_PORT:?Set COUCH_PORT to a free port}"
export COUCH_DATA_DIR COUCH_PORT
image=coturn/coturn:4.18.0-alpine
turn_port=$((COUCH_PORT + 1))
container=couch-live-turn-$turn_port

[[ -f build/core.mjs && -f dist/index.html ]] || { echo "Run bun run build first." >&2; exit 1; }
ip -o -4 addr show | grep -q " inet $address/" || { echo "$address is not an address of this machine." >&2; exit 1; }
for port in "$COUCH_PORT" "$turn_port"; do
  [[ -z $(ss -Htln "sport = :$port") ]] || { echo "Port $port is in use." >&2; exit 1; }
done
docker image inspect "$image" >/dev/null 2>&1 || { echo "Pull the relay image first: docker pull $image" >&2; exit 1; }
if docker container inspect "$container" >/dev/null 2>&1; then echo "Container $container already exists." >&2; exit 1; fi

mkdir -p -m 700 "$COUCH_DATA_DIR" "$COUCH_DATA_DIR/turn" "$COUCH_DATA_DIR/logs"
umask 077
# The credential stays in these files and Core's environment, never in arguments or logs.
# Keeping it across restarts lets paired receivers keep the ICE servers they fetched.
[[ -s $COUCH_DATA_DIR/turn/credential ]] || openssl rand -hex 24 > "$COUCH_DATA_DIR/turn/credential"
credential=$(<"$COUCH_DATA_DIR/turn/credential")
# TCP clients only, as COUCH_LIVE_TURN_URL asks. Relays reach private LAN peers only,
# so the relay can't carry traffic to the internet.
cat > "$COUCH_DATA_DIR/turn/turnserver.conf" <<EOF
listening-ip=$address
relay-ip=$address
listening-port=$turn_port
min-port=49160
max-port=49200
no-udp
no-tls
no-tcp-relay
lt-cred-mech
fingerprint
realm=couch
user=couch:$credential
no-multicast-peers
denied-peer-ip=0.0.0.0-255.255.255.255
allowed-peer-ip=10.0.0.0-10.255.255.255
allowed-peer-ip=172.16.0.0-172.31.255.255
allowed-peer-ip=192.168.0.0-192.168.255.255
no-software-attribute
log-file=stdout
simple-log
EOF
echo $$ > "$COUCH_DATA_DIR/live-dev.pid"
rm -f "$COUCH_DATA_DIR/turn/container"

cleanup() {
  trap - EXIT INT TERM
  if [[ -n ${core_pid:-} ]] && kill "$core_pid" 2>/dev/null; then wait "$core_pid" 2>/dev/null || true; fi
  # Only the container this run created, by the ID Docker recorded.
  if [[ -s $COUCH_DATA_DIR/turn/container ]]; then docker stop -t 5 "$(<"$COUCH_DATA_DIR/turn/container")" >/dev/null 2>&1 || true; fi
  rm -f "$COUCH_DATA_DIR/live-dev.pid" "$COUCH_DATA_DIR/core.pid" "$COUCH_DATA_DIR/turn/container"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Host networking: Docker publishes large relay port ranges badly (coturn's image README).
docker run --rm --pull=never --name "$container" --cidfile "$COUCH_DATA_DIR/turn/container" --network host --user "$(id -u):$(id -g)" \
  --mount type=tmpfs,destination=/var/lib/coturn \
  -v "$COUCH_DATA_DIR/turn/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
  "$image" -c /etc/coturn/turnserver.conf > "$COUCH_DATA_DIR/logs/turn.log" 2>&1 &
turn_pid=$!
for _ in {1..20}; do
  [[ -z $(ss -Htln "src $address:$turn_port") ]] || break
  kill -0 "$turn_pid" 2>/dev/null || { echo "The relay exited; see $COUCH_DATA_DIR/logs/turn.log" >&2; exit 1; }
  sleep 0.5
done
[[ -n $(ss -Htln "src $address:$turn_port") ]] || { echo "The relay didn't listen on $address:$turn_port; see $COUCH_DATA_DIR/logs/turn.log" >&2; exit 1; }

COUCH_LIVE_TURN_URL="turn:$address:$turn_port?transport=tcp" COUCH_LIVE_TURN_USERNAME=couch COUCH_LIVE_TURN_CREDENTIAL=$credential \
  node build/core.mjs >> "$COUCH_DATA_DIR/logs/couch.log" 2>&1 &
core_pid=$!
unset credential
echo "$core_pid" > "$COUCH_DATA_DIR/core.pid"
for _ in {1..60}; do
  if curl -skf "https://$address:$COUCH_PORT/api/health" >/dev/null; then break; fi
  kill -0 "$core_pid" 2>/dev/null || { echo "Core exited; see $COUCH_DATA_DIR/logs/couch.log" >&2; exit 1; }
  sleep 0.5
done
curl -skf "https://$address:$COUCH_PORT/api/health" >/dev/null || { echo "Core didn't answer on https://$address:$COUCH_PORT; see $COUCH_DATA_DIR/logs/couch.log" >&2; exit 1; }

echo "Couch: https://$address:$COUCH_PORT ($(grep -m1 -o 'Pairing code: [0-9]*' "$COUCH_DATA_DIR/logs/couch.log"))"
echo "Relay: turn:$address:$turn_port?transport=tcp, container $container"
echo "Logs: $COUCH_DATA_DIR/logs/couch.log and turn.log. Stop: kill $$"
wait -n "$core_pid" "$turn_pid" || true
echo "Core or the relay exited; stopping both." >&2
exit 1
