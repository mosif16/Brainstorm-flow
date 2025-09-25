#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"
PID_FILE="$ROOT_DIR/.devservers.pids"
DEFAULT_BACKEND_PORT=4000
DEFAULT_FRONTEND_PORT=5173

read_env_value() {
  local file_path="$1"
  local key="$2"

  if [[ -f "$file_path" ]]; then
    local line
    line=$(grep -E "^${key}=" "$file_path" | tail -n 1 || true)
    if [[ -n "$line" ]]; then
      echo "${line#*=}"
      return
    fi
  fi
}

BACKEND_PORT="$DEFAULT_BACKEND_PORT"
FRONTEND_PORT="$DEFAULT_FRONTEND_PORT"

BACKEND_ENV_FILE="$SERVER_DIR/.env"
if [[ ! -f "$BACKEND_ENV_FILE" && -f "$SERVER_DIR/.env.example" ]]; then
  BACKEND_ENV_FILE="$SERVER_DIR/.env.example"
fi

env_backend_port="${PORT:-}"
if [[ -n "$env_backend_port" ]]; then
  BACKEND_PORT="$env_backend_port"
else
  env_file_backend_port="$(read_env_value "$BACKEND_ENV_FILE" "PORT")"
  if [[ -n "$env_file_backend_port" ]]; then
    BACKEND_PORT="$env_file_backend_port"
  fi
fi

FRONTEND_ENV_FILE="$CLIENT_DIR/.env"
if [[ ! -f "$FRONTEND_ENV_FILE" && -f "$CLIENT_DIR/.env.example" ]]; then
  FRONTEND_ENV_FILE="$CLIENT_DIR/.env.example"
fi

env_frontend_port="${VITE_PORT:-}"
if [[ -n "$env_frontend_port" ]]; then
  FRONTEND_PORT="$env_frontend_port"
else
  env_file_frontend_port="$(read_env_value "$FRONTEND_ENV_FILE" "VITE_PORT")"
  if [[ -n "$env_file_frontend_port" ]]; then
    FRONTEND_PORT="$env_file_frontend_port"
  fi
fi

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

stop_service() {
  local label="$1"
  local pid="$2"

  if [[ -z "$pid" ]]; then
    return
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    echo "$label (PID $pid) is not running."
    return
  fi

  echo "Stopping $label (PID $pid)..."
  kill "$pid" 2>/dev/null || true

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$label stopped."
      return
    fi
    sleep 0.5
  done

  echo "$label did not exit gracefully; sending SIGKILL."
  kill -9 "$pid" 2>/dev/null || true
}

stop_service "backend" "${BACKEND:-}"
stop_service "frontend" "${FRONTEND:-}"

rm -f "$PID_FILE"

kill_port_processes() {
  local port="$1"
  local label="$2"

  if mapfile -t pids < <(lsof -ti tcp:"$port" 2>/dev/null); then
    echo "Terminating ${#pids[@]} process(es) still bound to port $port for $label: ${pids[*]}"
    for pid in "${pids[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        sleep 0.2
        if kill -0 "$pid" 2>/dev/null; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      fi
    done
  else
    echo "No remaining processes detected on port $port for $label."
  fi
}

kill_port_processes "$BACKEND_PORT" "backend"
kill_port_processes "$FRONTEND_PORT" "frontend"

echo "Frontend and backend dev servers stopped."
