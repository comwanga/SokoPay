#!/usr/bin/env bash
# Start both backend and frontend in development mode
set -e

# Check for .env
if [ ! -f .env ]; then
  echo "Creating .env from .env.example..."
  cp .env.example .env
  echo "Edit .env with your M-Pesa Daraja credentials before running."
fi

# Start backend in background
echo "Starting Rust backend on :3001..."
RUST_LOG=agri_pay=debug,tower_http=debug cargo run &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend..."
until curl -sf http://localhost:3001/api/health > /dev/null 2>&1; do
  sleep 1
done
echo "Backend ready."

# Start frontend
echo "Starting React frontend on :5173..."
cd frontend && npm run dev &
FRONTEND_PID=$!

echo ""
echo "AgriPay running:"
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
