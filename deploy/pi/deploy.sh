#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Building Remotion image..."
docker build -t nodetool-remotion:latest -f Dockerfile.remotion demo/

echo "==> Pulling latest NodeTool image..."
docker pull ghcr.io/nodetool-ai/nodetool:latest

echo "==> Loading environment variables..."
if [ ! -f .env ]; then
    echo "ERROR: .env file not found. Copy .env.example to .env and fill in values."
    exit 1
fi

# Export env vars for docker stack deploy
export $(grep -v '^#' .env | grep -v '^$' | xargs)

echo "==> Deploying stack..."
docker stack deploy -c stack.yml nodetool

echo "==> Waiting for services to start..."
sleep 15

echo "==> Service status:"
docker service ls | grep nodetool

echo ""
echo "==> Deployment complete!"
echo "    API: internal on port 7777"
echo "    Remotion: internal on port 3333"
echo ""
echo "    Configure Nginx Proxy Manager to expose the API externally."
echo "    Logs: docker service logs nodetool_api -f"
