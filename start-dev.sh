#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"
LOG_DIR="$ROOT_DIR/logs/dev"
PID_FILE="$ROOT_DIR/.devservers.pids"
DEFAULT_BACKEND_PORT=4000
DEFAULT_FRONTEND_PORT=5173
DEFAULT_RUNS_DIR="$ROOT_DIR/runs"

RUNS_DIR="${RUNS_DIR:-$DEFAULT_RUNS_DIR}"

mkdir -p "$LOG_DIR" "$RUNS_DIR"

parse_pid_file() {
  local file="$1"

  while IFS='=' read -r key raw_value || [[ -n "$key" ]]; do
    [[ -z "$key" ]] && continue

    case "$key" in
      BACKEND|FRONTEND)
        local cleaned="${raw_value%%#*}"
        cleaned="${cleaned%% *}"
        cleaned="${cleaned%%(*}"
        cleaned="${cleaned//[$'\r\n']}"

        if [[ "$cleaned" =~ ^[0-9]+$ ]]; then
          case "$key" in
            BACKEND) RECORDED_BACKEND_PID="$cleaned" ;;
            FRONTEND) RECORDED_FRONTEND_PID="$cleaned" ;;
          esac
        fi
        ;;
    esac
  done <"$file"
}

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

BACKEND_ENV_FILE="$SERVER_DIR/.env"
if [[ ! -f "$BACKEND_ENV_FILE" && -f "$SERVER_DIR/.env.example" ]]; then
  BACKEND_ENV_FILE="$SERVER_DIR/.env.example"
fi

BACKEND_PORT="${PORT:-}"
if [[ -z "$BACKEND_PORT" ]]; then
  BACKEND_PORT="$(read_env_value "$BACKEND_ENV_FILE" "PORT")"
fi
if [[ -z "$BACKEND_PORT" ]]; then
  BACKEND_PORT="$DEFAULT_BACKEND_PORT"
fi

FRONTEND_ENV_FILE="$CLIENT_DIR/.env"
if [[ ! -f "$FRONTEND_ENV_FILE" && -f "$CLIENT_DIR/.env.example" ]]; then
  FRONTEND_ENV_FILE="$CLIENT_DIR/.env.example"
fi

FRONTEND_PORT="${VITE_PORT:-}"
if [[ -z "$FRONTEND_PORT" ]]; then
  FRONTEND_PORT="$(read_env_value "$FRONTEND_ENV_FILE" "VITE_PORT")"
fi
if [[ -z "$FRONTEND_PORT" ]]; then
  FRONTEND_PORT="$DEFAULT_FRONTEND_PORT"
fi

RECORDED_BACKEND_PID=""
RECORDED_FRONTEND_PID=""

if [[ -f "$PID_FILE" ]]; then
  parse_pid_file "$PID_FILE"
fi

check_port() {
  local port="$1"
  local label="$2"
  local output

  if output=$(lsof -ti tcp:"$port" 2>/dev/null); then
    local count
    count=$(printf '%s' "$output" | grep -c '^[0-9]\+')
    local pids
    pids=$(printf '%s' "$output" | tr '\n' ' ' | sed 's/ *$//')
    echo "Detected $count process(es) on port $port for $label: $pids"
    if ((count > 1)); then
      echo "Warning: multiple processes detected on port $port."
    fi
  else
    echo "No processes detected on port $port for $label."
  fi
}

ensure_not_running() {
  local label="$1"
  local pid="$2"

  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    if kill -0 "$pid" 2>/dev/null; then
      echo "A $label dev server is already running with PID $pid."
      echo "Run ./stop-dev.sh to stop it before starting a new instance."
      exit 1
    fi
  fi
}

ensure_port_free() {
  local port="$1"
  local label="$2"

  local pids
  if pids=$(lsof -ti tcp:"$port" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//'); then
    if [[ -n "$pids" ]]; then
      echo "Port $port is currently in use by PID(s): $pids for $label."
      echo "Run ./stop-dev.sh or choose a different port before starting the dev server."
      exit 1
    fi
  fi
}

check_port "$BACKEND_PORT" "backend"
check_port "$FRONTEND_PORT" "frontend"

ensure_not_running "backend" "$RECORDED_BACKEND_PID"
ensure_not_running "frontend" "$RECORDED_FRONTEND_PID"

ensure_port_free "$BACKEND_PORT" "backend"
ensure_port_free "$FRONTEND_PORT" "frontend"

start_service() {
  local label="$1"
  local path="$2"
  local log_file="$3"
  shift 3
  local -a env_args=("$@")

  echo "Starting $label (logs: $log_file)..."
  nohup env RUNS_DIR="$RUNS_DIR" "${env_args[@]}" npm --prefix "$path" run dev >"$log_file" 2>&1 &
  local pid=$!
  disown "$pid"
  echo "$label started with PID $pid."
  echo "$pid"
}

BACKEND_PID=$(start_service "backend" "$SERVER_DIR" "$LOG_DIR/backend-dev.log" "PORT=$BACKEND_PORT")
FRONTEND_PID=$(start_service "frontend" "$CLIENT_DIR" "$LOG_DIR/frontend-dev.log" "VITE_PORT=$FRONTEND_PORT" "VITE_API_BASE=${VITE_API_BASE:-http://localhost:$BACKEND_PORT}")

{
  echo "BACKEND=$BACKEND_PID"
  echo "FRONTEND=$FRONTEND_PID"
  echo "BACKEND_PORT=$BACKEND_PORT"
  echo "FRONTEND_PORT=$FRONTEND_PORT"
  echo "RUNS_DIR=$RUNS_DIR"
} >"$PID_FILE"

echo "Backend and frontend dev servers are launching. PID info recorded in $PID_FILE."
echo "Log files:"
echo "  backend -> $LOG_DIR/backend-dev.log"
echo "  frontend -> $LOG_DIR/frontend-dev.log"
