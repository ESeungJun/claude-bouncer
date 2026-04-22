#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install || { echo "npm install failed"; read -n1; exit 1; }
fi

echo "Installing Claude Code hook..."
npm run install-hook || { echo "hook install failed"; read -n1; exit 1; }

echo "Starting claude-bouncer..."
exec npm start
