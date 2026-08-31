#!/bin/bash
#
# PixUp Batch Auto-Hook Publisher
#
# Reads WowIdea data from JSON export, generates hooks automatically,
# creates HookReveal videos, and publishes to Instagram.
#
# Input JSON format (export from nano_bot.wow_idea table):
# [
#   {"image_url": "https://s3.../1.jpg", "prompt": "девушка киберпанк", "title": "Киберпанк"},
#   {"image_url": "https://s3.../2.jpg", "prompt": "портрет в неоне", "title": "Неон"}
# ]
#
# Setup:
#   1. Export unpublished WowIdeas from nano_bot:
#      psql -h localhost -U nanobot -d nanobot -c \
#        "SELECT json_agg(row_to_json(t)) FROM (
#           SELECT image_url, prompt, title FROM wow_idea
#           WHERE instagram_published_at IS NULL LIMIT 10
#         ) t" -t -A > unpublished.json
#
#   2. Start Remotion server:
#      npx tsx demo/server.ts
#
#   3. Set your Instagram account ID:
#      export INSTAGRAM_ACCOUNT_ID="your_zernio_account_id"
#
#   4. Run this script:
#      ./pixup-batch-auto.sh unpublished.json
#
# Options:
#   DELAY_BETWEEN_POSTS=120  # Seconds between posts (default: 120)
#   DRY_RUN=1                # Test without publishing
#

set -e

# Config
INSTAGRAM_ACCOUNT_ID="${INSTAGRAM_ACCOUNT_ID:-YOUR_ZERNIO_INSTAGRAM_ACCOUNT_ID}"
WORKFLOW="examples/workflows/pixup-auto-hook.json"
DELAY_BETWEEN_POSTS="${DELAY_BETWEEN_POSTS:-120}"  # 2 minutes between posts
DRY_RUN="${DRY_RUN:-0}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)]${NC} $1"; }
info() { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"; }

# Check arguments
if [ -z "$1" ] || [ ! -f "$1" ]; then
    error "Usage: $0 <json_file>"
    echo ""
    echo "Example JSON format:"
    echo '[{"image_url": "https://...", "prompt": "...", "title": "..."}]'
    exit 1
fi

JSON_FILE="$1"

# Validate JSON
if ! jq empty "$JSON_FILE" 2>/dev/null; then
    error "Invalid JSON file: $JSON_FILE"
    exit 1
fi

# Count items
COUNT=$(jq length "$JSON_FILE")
if [ "$COUNT" -eq 0 ]; then
    warn "No items in JSON file"
    exit 0
fi

log "========================================="
log "PixUp Auto-Hook Batch Publisher"
log "========================================="
log "Items to process: $COUNT"
log "Instagram Account: $INSTAGRAM_ACCOUNT_ID"
log "Delay between posts: ${DELAY_BETWEEN_POSTS}s"
[ "$DRY_RUN" = "1" ] && warn "DRY RUN MODE - no actual publishing"
log "========================================="
echo ""

PUBLISHED=0
FAILED=0

# Process each item
for i in $(seq 0 $((COUNT - 1))); do
    ITEM=$(jq ".[$i]" "$JSON_FILE")
    IMAGE_URL=$(echo "$ITEM" | jq -r '.image_url')
    PROMPT=$(echo "$ITEM" | jq -r '.prompt')
    TITLE=$(echo "$ITEM" | jq -r '.title')

    info "[$((i + 1))/$COUNT] Processing: $TITLE"
    info "  URL: ${IMAGE_URL:0:50}..."
    info "  Prompt: ${PROMPT:0:40}..."

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY RUN] Would publish with auto-generated hook"
        ((PUBLISHED++))
        continue
    fi

    # Build params
    PARAMS=$(jq -n \
        --arg url "$IMAGE_URL" \
        --arg prompt "$PROMPT" \
        --arg title "$TITLE" \
        --arg account "$INSTAGRAM_ACCOUNT_ID" \
        '{
            image_url: $url,
            prompt: $prompt,
            title: $title,
            instagram_account_id: $account
        }')

    # Run workflow
    if npm run dev:nodetool -- run "$WORKFLOW" --params "$PARAMS" 2>&1; then
        log "  ✓ Published successfully"
        ((PUBLISHED++))

        # Rate limit
        if [ $i -lt $((COUNT - 1)) ] && [ $DELAY_BETWEEN_POSTS -gt 0 ]; then
            log "  Waiting ${DELAY_BETWEEN_POSTS}s before next post..."
            sleep $DELAY_BETWEEN_POSTS
        fi
    else
        error "  ✗ Failed to publish"
        ((FAILED++))
    fi

    echo ""
done

echo ""
log "========================================="
log "Batch complete!"
log "  Published: $PUBLISHED"
log "  Failed: $FAILED"
log "========================================="
