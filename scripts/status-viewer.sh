#!/bin/bash
PID_FILE="viewer.pid"
PORT=3000

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p $PID > /dev/null 2>&1; then
    echo "Viewer is running (PID: $PID)"
    exit 0
  fi
  # Clean up stale PID file
  rm -f "$PID_FILE"
fi

if [ -x "$(command -v lsof)" ]; then
  PORT_PID=$(lsof -t -i:$PORT)
  if [ ! -z "$PORT_PID" ]; then
    echo "Viewer is running on port $PORT (PID: $PORT_PID)"
    exit 0
  fi
fi

echo "Viewer is stopped."
