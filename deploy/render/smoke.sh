#!/bin/sh
# Checks a built demo image: it boots, refuses foreign hosts, runs jobs and stops cleanly.
# usage: sh deploy/render/smoke.sh IMAGE [PORT]
set -eu

image="$1"
port="${2:-10000}"
base="http://127.0.0.1:$port"
container=$(docker run -d --memory 512m -p "127.0.0.1:$port:10000" "$image")
trap 'docker rm -f "$container" >/dev/null' EXIT

fail() {
  echo "FAIL: $1"
  docker logs --tail 40 "$container"
  exit 1
}

retry() {
  attempts=0
  until "$@"; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 90 ] || fail "gave up on: $*"
    sleep 1
  done
}

healthy() { curl -sf -m 5 "$base/api/health" | grep -q '"status":"ok"'; }
finished() { curl -sf -m 5 "$base/api/snapshot" | grep -q '"completed":12,"failed":0'; }

retry healthy
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' "$base/api/meta")" = 403 ] || fail "foreign host accepted"
curl -sf -X POST "$base/api/demo/scenarios/mixed" >/dev/null || fail "scenario refused"
retry finished

docker stop -t 30 "$container" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$container")" = 0 ] || fail "unclean shutdown"
echo "demo image OK"
