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

check_port() {
  local port="$1"
  local label="$2"

  if mapfile -t found_pids < <(lsof -ti tcp:"$port" 2>/dev/null); then
    local count=${#found_pids[@]}
    echo "Detected $count process(es) on port $port for $label: ${found_pids[*]}"
    if ((count > 1)); then
      echo "Warning: multiple processes detected on port $port."
    fi
  else
    echo "No processes detected on port $port for $label."
  fi
}

check_port "$BACKEND_PORT" "backend"
check_port "$FRONTEND_PORT" "frontend"

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
