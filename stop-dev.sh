#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"
PID_FILE="$ROOT_DIR/.devservers.pids"
DEFAULT_BACKEND_PORT=4000
DEFAULT_FRONTEND_PORT=5173

if [[ -n "${PORT:-}" && "$PORT" != "$DEFAULT_BACKEND_PORT" ]]; then
  echo "Ignoring PORT override; backend shutdown targets fixed port $DEFAULT_BACKEND_PORT."
fi
BACKEND_PORT="$DEFAULT_BACKEND_PORT"

if [[ -n "${VITE_PORT:-}" && "$VITE_PORT" != "$DEFAULT_FRONTEND_PORT" ]]; then
  echo "Ignoring VITE_PORT override; frontend shutdown targets fixed port $DEFAULT_FRONTEND_PORT."
fi
FRONTEND_PORT="$DEFAULT_FRONTEND_PORT"

BACKEND=""
FRONTEND=""

parse_pid_file() {
  local file="$1"

  while IFS='=' read -r key raw_value || [[ -n "$key" ]]; do
    [[ -z "$key" ]] && continue

    case "$key" in
      BACKEND|FRONTEND|BACKEND_PORT|FRONTEND_PORT)
        local cleaned="${raw_value%%#*}"
        cleaned="${cleaned%% *}"
        cleaned="${cleaned%%(*}"
        cleaned="${cleaned//[$'\r\n']}"

        if [[ "$cleaned" =~ ^[0-9]+$ ]]; then
          case "$key" in
            BACKEND) BACKEND="$cleaned" ;;
            FRONTEND) FRONTEND="$cleaned" ;;
            BACKEND_PORT) BACKEND_PORT="$cleaned" ;;
            FRONTEND_PORT) FRONTEND_PORT="$cleaned" ;;
          esac
        fi
        ;;
    esac
  done <"$file"
}

if [[ -f "$PID_FILE" ]]; then
  parse_pid_file "$PID_FILE"
fi

send_signal() {
  local signal="$1"
  local target="$2"

if [[ "$signal" != -* ]]; then
  signal="-$signal"
fi

local status=0
if [[ "$target" == -* ]]; then
  if ! kill "$signal" -- "$target" 2>/dev/null; then
    status=$?
  fi
else
  if ! kill "$signal" "$target" 2>/dev/null; then
    status=$?
  fi
fi

return "$status"
}

stop_service() {
  local label="$1"
  local pid="$2"

  if [[ -z "$pid" ]]; then
    echo "No recorded PID for $label."
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$label (PID $pid) is not running."
    return
  fi

  local pgid=""
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  local signal_target="$pid"
  if [[ -n "$pgid" && "$pgid" =~ ^[0-9]+$ ]]; then
    signal_target="-${pgid}"
  fi

  echo "Stopping $label (PID $pid)..."
  if ! send_signal TERM "$signal_target"; then
    echo "Warning: unable to signal PID $pid with TERM (permission denied?)."
  fi

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$label stopped."
      return
    fi
    sleep 0.5
  done

  echo "$label did not exit gracefully; sending SIGKILL."
  if ! send_signal KILL "$signal_target"; then
    echo "Warning: unable to force kill PID $pid (permission denied?)."
  fi
}

stop_service "backend" "${BACKEND:-}"
stop_service "frontend" "${FRONTEND:-}"

rm -f "$PID_FILE"

UNABLE_TO_KILL=()

kill_port_processes() {
  local port="$1"
  local label="$2"
  local output

  if output=$(lsof -ti tcp:"$port" 2>/dev/null); then
    local count
    count=$(printf '%s' "$output" | grep -c '^[0-9]\+')
    local pids
    pids=$(printf '%s' "$output" | tr '\n' ' ' | sed 's/ *$//')
    echo "Terminating $count process(es) still bound to port $port for $label: $pids"
    printf '%s' "$output" | while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      local pgid
      pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
      local target="$pid"
      if [[ -n "$pgid" && "$pgid" =~ ^[0-9]+$ ]]; then
        target="-${pgid}"
      fi

      if ! send_signal TERM "$target"; then
        UNABLE_TO_KILL+=("$pid:$label:TERM_DENIED")
        continue
      fi

      for _ in {1..5}; do
        if ! lsof -p "$pid" >/dev/null 2>&1; then
          break
        fi
        sleep 0.2
      done

      if lsof -p "$pid" >/dev/null 2>&1; then
        if ! send_signal KILL "$target"; then
          UNABLE_TO_KILL+=("$pid:$label:KILL_DENIED")
          continue
        fi
        sleep 0.2
      fi

      if lsof -p "$pid" >/dev/null 2>&1; then
        UNABLE_TO_KILL+=("$pid:$label:STILL_RUNNING")
      fi
    done
  else
    echo "No remaining processes detected on port $port for $label."
  fi
}

describe_port_processes() {
  local port="$1"
  if lsof -nP -i tcp:"$port" -sTCP:LISTEN 2>/dev/null; then
    return
  fi
}

kill_port_processes "$BACKEND_PORT" "backend"
kill_port_processes "$FRONTEND_PORT" "frontend"

wait_for_port_release() {
  local port="$1"
  local label="$2"
  local output

  for _ in {1..10}; do
    if ! lsof -ti tcp:"$port" >/dev/null 2>&1; then
      echo "Confirmed port $port clear for $label."
      return
    fi
    sleep 0.3
  done

  if output=$(lsof -ti tcp:"$port" 2>/dev/null); then
    local pids
    pids=$(printf '%s' "$output" | tr '\n' ' ' | sed 's/ *$//')
    echo "Warning: port $port still in use by PID(s) $pids for $label after stop attempts."
    describe_port_processes "$port"
  fi
}

wait_for_port_release "$BACKEND_PORT" "backend"
wait_for_port_release "$FRONTEND_PORT" "frontend"

if (( ${#UNABLE_TO_KILL[@]} > 0 )); then
  echo "Some processes could not be terminated automatically:"
  for entry in "${UNABLE_TO_KILL[@]}"; do
    IFS=':' read -r pid label action <<<"$entry"
    echo "  - PID $pid on $label port (action $action). Stop it manually if it persists."
  done
fi

if [[ -z "${STOP_DEV_SILENT:-}" ]]; then
  echo "Frontend and backend dev servers stopped."
fi
