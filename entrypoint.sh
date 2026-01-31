#!/usr/bin/env bash
set -euo pipefail

# Generate SSH host keys if missing
ssh-keygen -A >/dev/null 2>&1 || true

# Start SSH daemon in background
/usr/sbin/sshd

# Serve the app
exec python3 -m http.server 8000 --directory /app
