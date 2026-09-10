#!/usr/bin/env bash
# Update only this project's UI; preserve the database and the previous container.
set -Eeuo pipefail
port="${1:-3003}"; revision="${2:-}"; expected="${3:-}"
[[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) || { echo 'Invalid port.' >&2; exit 1; }
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$expected" =~ ^[a-f0-9]{40}$ ]] || { echo 'Full revisions required.' >&2; exit 1; }
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
container='personal-application-tracking'
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then sudo -v; docker_cmd=(sudo docker); "${docker_cmd[@]}" info >/dev/null; fi
inspect() { "${docker_cmd[@]}" inspect --format "$1" "$container"; }
[[ "$(inspect '{{index .Config.Labels "app.owner"}}')" == "$container" ]] || { echo 'Container ownership mismatch; no changes made.' >&2; exit 1; }
[[ "$(inspect '{{index .Config.Labels "app.port"}}')" == "$port" ]] || { echo 'Port mismatch; no changes made.' >&2; exit 1; }
old_revision="$(inspect '{{index .Config.Labels "app.revision"}}')"
health="$(inspect '{{if .State.Health}}{{.State.Health.Status}}{{end}}')"
if [[ "$old_revision" == "$revision" && "$health" == healthy ]]; then echo "UPDATE_OK: already running revision=$revision port=$port"; exit 0; fi
[[ "$old_revision" == "$expected" && "$health" == healthy ]] || { echo 'The running version or health differs from the expected base; stopped to protect the current deployment.' >&2; exit 1; }
[[ "$(inspect '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}:{{.Name}}:{{.RW}}{{end}}{{end}}')" == 'volume:pat-tracker-data:true' ]] || { echo 'Unexpected data mount.' >&2; exit 1; }
[[ "$(inspect '{{range .Mounts}}{{if eq .Destination "/app/backups"}}{{.Type}}:{{.Name}}:{{.RW}}{{end}}{{end}}')" == 'volume:pat-tracker-backups:true' ]] || { echo 'Unexpected backup mount.' >&2; exit 1; }
old_image="$(inspect '{{.Image}}')"
[[ "$old_image" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid base image id.' >&2; exit 1; }
"${docker_cmd[@]}" image inspect "$old_image" >/dev/null
image="personal-application-tracking:${revision:0:12}"
echo 'Building UI update using the existing image. No registry or npm access is needed.'
"${docker_cmd[@]}" build --pull=false --network none --build-arg "BASE_IMAGE=$old_image" --file "$root_dir/deploy/Dockerfile.web" --tag "$image" "$root_dir"
echo 'Saving an online SQLite snapshot to the existing backup volume...'
"${docker_cmd[@]}" exec "$container" node scripts/backup.js
stamp="$(date +%Y%m%d%H%M%S)-$$"
rollback="$container-rollback-${old_revision:0:12}-$stamp"
failed="$container-failed-${revision:0:12}-$stamp"
if "${docker_cmd[@]}" container inspect "$rollback" >/dev/null 2>&1 || "${docker_cmd[@]}" container inspect "$failed" >/dev/null 2>&1; then
  echo 'Recovery container name already exists; no container has been stopped.' >&2; exit 1
fi
stopped=false; renamed=false
recover() {
  trap - ERR INT TERM
  set +e
  echo 'Update interrupted or unhealthy. Attempting to restart the original version; no data volume is deleted.' >&2
  if [[ "$renamed" == true ]]; then
    if "${docker_cmd[@]}" container inspect "$container" >/dev/null 2>&1; then
      current_revision="$(inspect '{{index .Config.Labels "app.revision"}}')"
      current_owner="$(inspect '{{index .Config.Labels "app.owner"}}')"
      if [[ "$current_revision" != "$revision" || "$current_owner" != "$container" ]]; then
        echo "Unexpected replacement container; manual recovery required from $rollback." >&2; exit 1
      fi
      "${docker_cmd[@]}" stop "$container" >/dev/null
      "${docker_cmd[@]}" rename "$container" "$failed" || { echo "Manual recovery required: $rollback" >&2; exit 1; }
    fi
    "${docker_cmd[@]}" rename "$rollback" "$container" || { echo "Manual recovery required: $rollback" >&2; exit 1; }
    "${docker_cmd[@]}" start "$container"
  elif [[ "$stopped" == true ]]; then
    "${docker_cmd[@]}" start "$container"
  fi
  exit 1
}
trap recover ERR INT TERM
stopped=true
"${docker_cmd[@]}" stop "$container" >/dev/null
"${docker_cmd[@]}" rename "$container" "$rollback"
renamed=true
"${docker_cmd[@]}" run -d --name "$container" \
  --label "app.owner=$container" --label "app.revision=$revision" --label "app.port=$port" \
  --restart unless-stopped --security-opt no-new-privileges:true --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p "0.0.0.0:$port:3000" -v pat-tracker-data:/app/data -v pat-tracker-backups:/app/backups "$image"
for attempt in {1..45}; do
  health="$(inspect '{{if .State.Health}}{{.State.Health.Status}}{{end}}')"
  if [[ "$health" == healthy ]]; then
    "${docker_cmd[@]}" exec "$container" node -e "Promise.all([fetch('http://127.0.0.1:3000/').then(r=>r.text()),fetch('http://127.0.0.1:3000/assets/app.js').then(r=>r.text())]).then(([h,j])=>{if(!h.includes('todos-page')||!j.includes('data-quick-stage'))process.exitCode=1}).catch(()=>process.exitCode=1)"
    trap - ERR INT TERM
    echo "UPDATE_OK: port=$port revision=$revision"
    echo 'Data and existing events preserved in pat-tracker-data. SQLite snapshot saved in pat-tracker-backups.'
    echo "Previous container retained (stopped): $rollback"
    exit 0
  fi
  [[ "$health" != unhealthy && "$(inspect '{{.State.Running}}')" == true ]] || break
  sleep 2
done
echo 'New container did not become healthy.' >&2
recover
