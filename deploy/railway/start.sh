#!/bin/sh
# Starts Caddy on $PORT and the game server on 8081.
# During a deploy the old container still holds the database lock for a few
# seconds, so the server is restarted until it gets the lock (and after any
# crash, so it reloads its state from the database).
set -u
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy=$!
child=

stop() {
  [ -n "$child" ] && kill -TERM "$child" 2>/dev/null && wait "$child"
  kill -TERM "$caddy" 2>/dev/null
  exit 0
}
trap stop TERM INT

while true; do
  PORT=8081 node --import tsx src/api/server.ts &
  child=$!
  wait "$child"
  echo "Game server exited ($?); restarting in 3s"
  sleep 3
done
