#!/usr/bin/env bash
# Exercise deployment decision paths without connecting to a host or Docker daemon.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_dir/.local"
test_dir="$(mktemp -d "$project_dir/.local/deploy-test.XXXXXXXX")"
revision='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
docker() {
  printf '%s\n' "$*" >> "$calls"
  case "${1:-} ${2:-}" in
    'info ') return 0 ;;
    'info --format') if [[ "$scenario" == 'offline-architecture' ]]; then echo 'aarch64'; else echo 'x86_64'; fi ;;
    'load --input') [[ "$scenario" != 'offline-load-failure' ]] ;;
    'container inspect') [[ "$scenario" == 'existing-container' ]] ;;
    'volume inspect')
      if [[ "$scenario" == 'existing-volume' ]]; then echo 'another-project'; return 0; fi
      return 1 ;;
    'volume create') echo 'test-volume' ;;
    'inspect --format')
      if [[ "$scenario" == 'existing-container' ]]; then echo 'another-project'; else echo 'healthy'; fi ;;
    'build --tag') [[ "$scenario" != 'build-failure' ]] ;;
    'run -d') echo 'test-container' ;;
    *) return 0 ;;
  esac
}
ss() { if [[ "$scenario" == 'occupied-port' ]]; then echo 'LISTEN 0 10 0.0.0.0:3003'; fi; return 0; }
curl() { echo '{"ok":true}'; }
export -f docker ss curl
for scenario in success occupied-port existing-container existing-volume build-failure offline-success offline-missing offline-architecture offline-load-failure; do
  calls="$test_dir/$scenario.calls"
  export scenario calls
  mode='online'
  script="$project_dir/deploy/run-docker.sh"
  if [[ "$scenario" == offline-* ]]; then
    mode='offline'
    fixture="$test_dir/$scenario"
    mkdir -p "$fixture/deploy" "$fixture/production_modules/express"
    cp "$script" "$fixture/deploy/run-docker.sh"
    script="$fixture/deploy/run-docker.sh"
    if [[ "$scenario" != 'offline-missing' ]]; then printf 'mock image' > "$fixture/offline-node-base.tar"; fi
  fi
  if bash "$script" 3003 "$revision" "$mode" > "$test_dir/$scenario.output" 2>&1; then
    result=0
  else
    result=$?
  fi
  if [[ "$scenario" == 'success' || "$scenario" == 'offline-success' ]]; then
    [[ "$result" == 0 ]] || { cat "$test_dir/$scenario.output"; exit 1; }
    [[ "$(cat "$calls")" == *'run -d'* ]] || exit 1
    [[ "$(cat "$test_dir/$scenario.output")" == *'DEPLOYMENT_OK'* ]] || exit 1
    if [[ "$mode" == 'offline' ]]; then
      [[ "$(cat "$calls")" == *'load --input'* ]] || exit 1
      [[ "$(cat "$calls")" == *'--pull=false --network none'* ]] || exit 1
    fi
  else
    [[ "$result" != 0 ]] || { echo "Expected failure: $scenario"; exit 1; }
    [[ "$(cat "$calls")" != *'run -d'* ]] || { echo "Unexpected container start: $scenario"; exit 1; }
    if [[ "$scenario" != 'build-failure' ]]; then
      [[ "$(cat "$calls")" != *'build --tag'* ]] || { echo "Unexpected build: $scenario"; exit 1; }
    fi
  fi
  echo "PASS: $scenario"
done
