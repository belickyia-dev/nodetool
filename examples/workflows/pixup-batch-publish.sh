#!/bin/bash
#
# PixUp Batch Publisher
# Reads S3 URLs from file or stdin, publishes each as Instagram Reel
#
# Setup:
#   1. Get Zernio API key: https://zernio.com
#   2. Connect Instagram account in Zernio dashboard
#   3. Copy your Instagram Account ID from Zernio
#   4. Store key: npm run dev:nodetool -- secrets store ZERNIO_API_KEY
#
# Usage:
#   # From file with URLs (one per line)
#   ./pixup-batch-publish.sh urls.txt
#
#   # With custom caption
#   CAPTION="Check out this AI art! 🎨" ./pixup-batch-publish.sh urls.txt
#
#   # Direct from nano_bot PostgreSQL
#   psql -h localhost -U nanobot -d nanobot -t -c \
#     "SELECT image_url FROM wow_idea WHERE instagram_published_at IS NULL LIMIT 10" \
#     | ./pixup-batch-publish.sh
#

set -e

# Config
INSTAGRAM_ACCOUNT_ID="${INSTAGRAM_ACCOUNT_ID:-YOUR_ZERNIO_INSTAGRAM_ACCOUNT_ID}"
CAPTION="${CAPTION:-✨ AI-generated art | Made with PixUp 🤖}"
WORKFLOW="examples/workflows/pixup-reels-publisher.ts"
DELAY_BETWEEN_POSTS="${DELAY_BETWEEN_POSTS:-60}"  # seconds

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $1"; }

# Read URLs from file or stdin
if [ -n "$1" ] && [ -f "$1" ]; then
    URLS=$(cat "$1" | grep -v '^#' | grep -v '^$')
else
    URLS=$(cat | grep -v '^#' | grep -v '^$')
fi

if [ -z "$URLS" ]; then
    error "No URLs provided"
    echo "Usage: $0 <urls_file>"
    echo "   or: echo 'https://...' | $0"
    exit 1
fi

COUNT=$(echo "$URLS" | wc -l | tr -d ' ')
log "Starting batch publish of $COUNT images..."

PUBLISHED=0
FAILED=0

while IFS= read -r url; do
    [ -z "$url" ] && continue

    log "Publishing: ${url:0:60}..."

    PARAMS=$(jq -n \
        --arg url "$url" \
        --arg caption "$CAPTION" \
        --arg account "$INSTAGRAM_ACCOUNT_ID" \
        '{image_url: $url, caption: $caption, instagram_account_id: $account}')

    if npm run dev:nodetool -- run "$WORKFLOW" --params "$PARAMS" 2>&1; then
        log "✓ Published successfully"
        ((PUBLISHED++))
    else
        error "✗ Failed to publish"
        ((FAILED++))
    fi

    # Rate limit - Instagram doesn't like rapid posting
    if [ $DELAY_BETWEEN_POSTS -gt 0 ]; then
        log "Waiting ${DELAY_BETWEEN_POSTS}s before next post..."
        sleep $DELAY_BETWEEN_POSTS
    fi

done <<< "$URLS"

echo ""
log "========================================="
log "Batch complete: $PUBLISHED published, $FAILED failed"
log "========================================="
