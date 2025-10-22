#!/bin/bash

# UPPCL Power Dashboard Startup Script
# Ensures clean startup and proper process management

echo "🚀 Starting UPPCL Power Dashboard..."

# Kill any existing dashboard processes more thoroughly
echo "🧹 Cleaning up existing processes..."
pkill -f dashboard_server 2>/dev/null || true
pkill -f "node.*dashboard" 2>/dev/null || true
pgrep -f dashboard_server | xargs kill -9 2>/dev/null || true
sleep 2

# Check if port 3000 is still in use and kill it
if lsof -ti:3000 >/dev/null 2>&1; then
    echo "🔧 Port 3000 still in use, forcefully killing processes..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# Start the dashboard server
echo "🌐 Starting dashboard server on http://localhost:3000..."
node dashboard_server.js &

# Give it a moment to start
sleep 3

# Check if it's running
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ Dashboard started successfully!"
    echo "📊 Dashboard: http://localhost:3000"
    echo "🔗 API Status: http://localhost:3000/api/status"
    echo "📈 API History: http://localhost:3000/api/history"
    echo ""
    echo "Press Ctrl+C to stop the dashboard"
    
    # Keep the script running and show logs
    wait
else
    echo "❌ Failed to start dashboard"
    exit 1
fi