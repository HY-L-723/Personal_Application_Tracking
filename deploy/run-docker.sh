#!/usr/bin/env bash
# First deployment using the existing Docker daemon, without Compose or host Node.js.
set -Eeuo pipefail
port="${1:-3003}"
revision="${2:-}"
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
  echo 'Invalid application port.' >&2; exit 1
fi
if [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'A full Git revision is required.' >&2; exit 1
fi
root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
container='personal-application-tracking'
owner_label='personal-application-tracking'
data_volume='pat-tracker-data'
backup_volume='pat-tracker-backups'
image="personal-application-tracking:${revision:0:12}"
command -v docker >/dev/null || { echo 'Docker is not installed.' >&2; exit 1; }
command -v ss >/dev/null || { echo 'Cannot check ports: ss is unavailable.' >&2; exit 1; }
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
  echo 'Docker needs elevated permission. Enter the server sudo password if prompted.'
  sudo -v
  docker_cmd=(sudo docker)
  "${docker_cmd[@]}" info >/dev/null
fi
if "${docker_cmd[@]}" container inspect "$container" >/dev/null 2>&1; then
  existing_owner="$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "app.owner"}}' "$container")"
  existing_revision="$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "app.revision"}}' "$container")"
  existing_port="$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "app.port"}}' "$container")"
  existing_health="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")"
  if [[ "$existing_owner" == "$owner_label" && "$existing_revision" == "$revision" && "$existing_port" == "$port" && "$existing_health" == 'healthy' ]]; then
    echo "This revision is already deployed and healthy on port $port."; exit 0
  fi
  echo "Container '$container' already exists. Stopped to avoid replacing an existing deployment; plan its update separately." >&2
  exit 1
fi
if [[ -n "$(ss -H -ltn "sport = :$port")" ]]; then
  echo "Port $port is occupied. No existing service has been stopped." >&2; exit 1
fi
for volume in "$data_volume" "$backup_volume"; do
  if "${docker_cmd[@]}" volume inspect "$volume" >/dev/null 2>&1; then
    existing_owner="$("${docker_cmd[@]}" volume inspect --format '{{index .Labels "app.owner"}}' "$volume")"
    if [[ "$existing_owner" != "$owner_label" ]]; then
      echo "Volume '$volume' belongs to another deployment. Stopped to protect its data." >&2; exit 1
    fi
  fi
done
echo "Building $image from uploaded source..."
"${docker_cmd[@]}" build --tag "$image" "$root_dir"
for volume in "$data_volume" "$backup_volume"; do
  if ! "${docker_cmd[@]}" volume inspect "$volume" >/dev/null 2>&1; then
    "${docker_cmd[@]}" volume create --label "app.owner=$owner_label" "$volume" >/dev/null
  fi
done
echo "Starting a new container on port $port..."
"${docker_cmd[@]}" run -d \
  --name "$container" \
  --label "app.owner=$owner_label" \
  --label "app.revision=$revision" \
  --label "app.port=$port" \
  --restart unless-stopped \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=3 \
  -p "0.0.0.0:$port:3000" \
  -v "$data_volume:/app/data" \
  -v "$backup_volume:/app/backups" \
  "$image"
for attempt in {1..45}; do
  health="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")"
  if [[ "$health" == 'healthy' ]]; then
    if command -v curl >/dev/null; then
      curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$port/healthz"
      echo
    fi
    echo "DEPLOYMENT_OK: port=$port revision=$revision"
    echo "Data volume: $data_volume (preserved on container restart)"
    exit 0
  fi
  running="$("${docker_cmd[@]}" inspect --format '{{.State.Running}}' "$container")"
  if [[ "$health" == 'unhealthy' || "$running" != 'true' ]]; then break; fi
  sleep 2
done
echo 'Health check failed. This project container and volumes were kept for diagnosis.' >&2
"${docker_cmd[@]}" logs --tail 60 "$container" >&2
exit 1
