#!/bin/bash
PID_FILE="viewer.pid"
PORT=3000

# Check if port is already in use
if [ -x "$(command -v lsof)" ]; then
  PORT_PID=$(lsof -t -i:$PORT)
  if [ ! -z "$PORT_PID" ]; then
    echo "Port $PORT is already in use by process $PORT_PID."
    exit 1
  fi
fi

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if ps -p $PID > /dev/null 2>&1; then
    echo "Viewer is already running (PID: $PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

echo "Starting viewer server in background..."
mkdir -p logs
# Start the server process via npm run start
nohup npm run start > logs/viewer.out 2>&1 &
NEW_PID=$!

echo $NEW_PID > "$PID_FILE"
echo "Viewer started (PID: $NEW_PID). Output redirected to logs/viewer.out"
echo "URL: http://localhost:$PORT"
