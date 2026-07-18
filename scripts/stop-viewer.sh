#!/bin/bash
PID_FILE="viewer.pid"
PORT=3000

# Try using PID file first
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p $PID > /dev/null 2>&1; then
    echo "Stopping viewer server (PID: $PID)..."
    kill $PID
    sleep 2
    if ps -p $PID > /dev/null 2>&1; then
      echo "Process did not stop, forcing kill..."
      kill -9 $PID
    fi
    echo "Viewer stopped."
    rm -f "$PID_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Fallback: Check if port 3000 is still bound and kill that process
if [ -x "$(command -v lsof)" ]; then
  PORT_PID=$(lsof -t -i:$PORT)
  if [ ! -z "$PORT_PID" ]; then
    echo "Found process $PORT_PID running on port $PORT. Stopping it..."
    kill $PORT_PID
    sleep 2
    if ps -p $PORT_PID > /dev/null 2>&1; then
      kill -9 $PORT_PID
    fi
    echo "Viewer on port $PORT stopped."
    exit 0
  fi
fi

echo "Viewer was not running."
