#!/usr/bin/env bash
# Mock Docker only: no SSH, Docker daemon, production data or real containers.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_dir/.local"
test_dir="$(mktemp -d "$project_dir/.local/update-web-test.XXXXXXXX")"
revision='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
expected='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
docker() {
  printf '%s\n' "$*" >> "$calls"
  case "$1" in
    info|image) return 0 ;;
    inspect)
      state="$(cat "$state_file")"
      case "$3" in
        *app.owner*) if [[ "$scenario" == foreign-owner ]]; then echo other; else echo personal-application-tracking; fi ;;
        *app.port*) echo 3003 ;;
        *app.revision*)
          if [[ "$state" == new || "$scenario" == already-current ]]; then echo "$revision";
          elif [[ "$scenario" == wrong-base ]]; then echo cccccccccccccccccccccccccccccccccccccccc; else echo "$expected"; fi ;;
        *State.Health*) if [[ "$state" == new && "$scenario" == health-failure ]]; then echo unhealthy; else echo healthy; fi ;;
        *State.Running*) echo true ;;
        *'/app/data'*) if [[ "$scenario" == wrong-mount ]]; then echo bind:other:true; else echo volume:pat-tracker-data:true; fi ;;
        *'/app/backups'*) echo volume:pat-tracker-backups:true ;;
        *'.Image'*) echo sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;
        *) echo 'Unexpected inspect' >&2; return 1 ;;
      esac ;;
    container) [[ "$3" == personal-application-tracking && "$(cat "$state_file")" != absent ]] ;;
    build) [[ "$scenario" != build-failure ]] ;;
    exec)
      if [[ "$4" == scripts/backup.js ]]; then [[ "$scenario" != backup-failure ]];
      else [[ "$scenario" != asset-failure ]]; fi ;;
    stop) return 0 ;;
    rename)
      if [[ "$2" == personal-application-tracking ]]; then echo absent > "$state_file"; else echo old > "$state_file"; fi ;;
    run) echo new > "$state_file"; [[ "$scenario" != run-failure ]] ;;
    start) return 0 ;;
    *) echo "Unexpected Docker command: $*" >&2; return 1 ;;
  esac
}
export -f docker
export revision expected
for scenario in success already-current foreign-owner wrong-base wrong-mount build-failure backup-failure run-failure health-failure asset-failure; do
  calls="$test_dir/$scenario.calls"; state_file="$test_dir/$scenario.state"
  echo old > "$state_file"
  export scenario calls state_file
  if bash "$project_dir/deploy/update-web.sh" 3003 "$revision" "$expected" > "$test_dir/$scenario.output" 2>&1; then result=0; else result=$?; fi
  recorded="$(cat "$calls")"
  if [[ "$scenario" == success || "$scenario" == already-current ]]; then
    [[ "$result" == 0 && "$(cat "$test_dir/$scenario.output")" == *UPDATE_OK* ]] || { cat "$test_dir/$scenario.output"; exit 1; }
    if [[ "$scenario" == success ]]; then [[ "$recorded" == *'--pull=false --network none'* && "$recorded" == *'scripts/backup.js'* && "$recorded" == *'run -d'* ]];
    else [[ "$recorded" != *'build '* && "$recorded" != *'stop '* ]]; fi
  else
    [[ "$result" != 0 ]] || { echo "Expected failure: $scenario"; exit 1; }
    if [[ "$scenario" == run-failure || "$scenario" == health-failure || "$scenario" == asset-failure ]]; then
      [[ "$recorded" == *'start personal-application-tracking'* && "$(cat "$state_file")" == old ]] || { cat "$test_dir/$scenario.output"; exit 1; }
    else
      [[ "$recorded" != *'stop '* && "$recorded" != *'run -d'* ]] || { echo "Unexpected interruption: $scenario"; exit 1; }
    fi
  fi
  [[ "$recorded" != *'volume rm'* && "$recorded" != *'container rm'* ]]
  echo "PASS: $scenario"
done
