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

if [[ -n "${PORT:-}" && "$PORT" != "$DEFAULT_BACKEND_PORT" ]]; then
  echo "Ignoring PORT override; backend uses fixed port $DEFAULT_BACKEND_PORT."
fi
BACKEND_PORT="$DEFAULT_BACKEND_PORT"

if [[ -n "${VITE_PORT:-}" && "$VITE_PORT" != "$DEFAULT_FRONTEND_PORT" ]]; then
  echo "Ignoring VITE_PORT override; frontend uses fixed port $DEFAULT_FRONTEND_PORT."
fi
FRONTEND_PORT="$DEFAULT_FRONTEND_PORT"

RECORDED_BACKEND_PID=""
RECORDED_FRONTEND_PID=""

if [[ -f "$PID_FILE" ]]; then
  parse_pid_file "$PID_FILE"
fi

is_project_process() {
  local pid="$1"
  [[ -z "$pid" ]] && return 1

  local command
  command=$(ps -o command= -p "$pid" 2>/dev/null | tr -d '\r' || true)
  [[ -z "$command" ]] && return 1

  if [[ "$command" == *"$SERVER_DIR"* || "$command" == *"$CLIENT_DIR"* ]]; then
    return 0
  fi

  case "$command" in
    *node*tsx*server/src*|*vite*|*npm*run*dev*)
      return 0
      ;;
  esac

  return 1
}

NEED_AUTO_CLEANUP=0
declare -a FOREIGN_CONFLICTS=()

check_port_conflicts() {
  local port="$1"
  local label="$2"
  local recorded_pid="$3"
  local output

  if output=$(lsof -ti tcp:"$port" 2>/dev/null); then
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      if [[ -n "$recorded_pid" && "$pid" == "$recorded_pid" ]]; then
        NEED_AUTO_CLEANUP=1
        continue
      fi
      if is_project_process "$pid"; then
        NEED_AUTO_CLEANUP=1
        continue
      fi
      FOREIGN_CONFLICTS+=("$label:$port:$pid")
    done <<<"$output"
  fi
}

check_port_conflicts "$BACKEND_PORT" "backend" "$RECORDED_BACKEND_PID"
check_port_conflicts "$FRONTEND_PORT" "frontend" "$RECORDED_FRONTEND_PID"

if (( ${#FOREIGN_CONFLICTS[@]} > 0 )); then
  echo "Found non-project processes on required ports:"
  for conflict in "${FOREIGN_CONFLICTS[@]}"; do
    IFS=':' read -r label port pid <<<"$conflict"
    echo "  - $label port $port in use by PID $pid. Stop it manually, then re-run ./start-dev.sh."
  done
  exit 1
fi

describe_port_processes() {
  local port="$1"
  if lsof -nP -i tcp:"$port" -sTCP:LISTEN 2>/dev/null; then
    return
  fi
}

if (( NEED_AUTO_CLEANUP )); then
  echo "Detected lingering dev servers; running stop-dev.sh to clean them up..."
  STOP_DEV_SILENT=1 "$ROOT_DIR/stop-dev.sh"
  RECORDED_BACKEND_PID=""
  RECORDED_FRONTEND_PID=""
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
      describe_port_processes "$port"
      echo "Run ./stop-dev.sh or terminate the listed process(es) before starting the dev server."
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

  >&2 echo "Starting $label (logs: $log_file)..."
  nohup env RUNS_DIR="$RUNS_DIR" "${env_args[@]}" npm --prefix "$path" run dev >"$log_file" 2>&1 &
  local pid=$!
  disown "$pid"
  >&2 echo "$label started with PID $pid."
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
