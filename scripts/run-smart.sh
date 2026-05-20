#!/bin/bash
# run-smart.sh
#
# Runs a command with idle-timeout detection (not total timeout).
# Keeps sandbox alive with heartbeat output.
# Only kills if process has NO activity for MAX_IDLE seconds.
#
# Activity is detected by:
#   1. New output (log file size increases)
#   2. CPU usage > 5%
#
# Output is streamed in REAL-TIME (not buffered until end).
#
# Usage:
#   ./run-smart.sh <command> [args...]
#   MAX_IDLE=600 ./run-smart.sh python long_script.py
#
# Environment variables:
#   MAX_IDLE           - Seconds of inactivity before killing (default: 300 = 5 min)
#   HEARTBEAT_INTERVAL - Seconds between activity checks (default: 30)

MAX_IDLE=${MAX_IDLE:-300}
HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL:-30}
LOG_FILE="/tmp/logs/cmd_$$.log"

mkdir -p /tmp/logs
touch "$LOG_FILE"

echo "[run-smart] Starting: $@"
echo "[run-smart] MAX_IDLE=${MAX_IDLE}s, HEARTBEAT_INTERVAL=${HEARTBEAT_INTERVAL}s"
echo "---"

# Run command with unbuffered output, stream to both terminal AND log file
stdbuf -oL -eL "$@" 2>&1 | tee "$LOG_FILE" &
pipe_pid=$!

# Get the actual command PID (the process before tee in the pipeline)
sleep 0.5
cmd_pid=$(pgrep -P $pipe_pid 2>/dev/null | head -1)
if [ -z "$cmd_pid" ]; then
    cmd_pid=$pipe_pid
fi

echo "[run-smart] Process started (monitoring PID: $pipe_pid)"
echo "---"

last_size=0
idle_time=0

while kill -0 $pipe_pid 2>/dev/null; do
    current_size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)

    # Try to get CPU of the actual command
    cpu=$(ps -p $cmd_pid -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
    if [ -z "$cpu" ]; then
        cpu=$(ps -p $pipe_pid -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
    fi
    cpu=${cpu:-0}

    # Check for ANY activity: new output OR CPU usage > 5%
    cpu_int=${cpu%.*}
    cpu_int=${cpu_int:-0}

    if [ "$current_size" -gt "$last_size" ] || [ "$cpu_int" -gt 5 ]; then
        idle_time=0
        last_size=$current_size
        echo "[heartbeat] $(date '+%H:%M:%S') - ACTIVE (CPU: ${cpu}%, Output: ${current_size} bytes)"
    else
        idle_time=$((idle_time + HEARTBEAT_INTERVAL))
        echo "[heartbeat] $(date '+%H:%M:%S') - idle ${idle_time}s/${MAX_IDLE}s (CPU: ${cpu}%)"

        if [ $idle_time -ge $MAX_IDLE ]; then
            echo ""
            echo "[ERROR] =========================================="
            echo "[ERROR] No activity for ${MAX_IDLE}s - process appears hung"
            echo "[ERROR] Killing process..."
            echo "[ERROR] =========================================="
            kill -9 $pipe_pid 2>/dev/null
            kill -9 $cmd_pid 2>/dev/null
            rm -f "$LOG_FILE"
            exit 1
        fi
    fi

    sleep $HEARTBEAT_INTERVAL
done

wait $pipe_pid
exit_code=$?

echo "---"
echo "[run-smart] Completed (exit code: $exit_code)"

rm -f "$LOG_FILE"
exit $exit_code
