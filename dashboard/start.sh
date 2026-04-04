#!/bin/bash
# Start the Portfolio Dashboard Server
cd "$(dirname "$0")"
python3 server.py &
echo "Dashboard server started on port 8080"
