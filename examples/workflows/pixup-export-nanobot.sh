#!/bin/bash
#
# Export unpublished WowIdea records from nano_bot PostgreSQL
#
# Usage:
#   ./pixup-export-nanobot.sh                    # Export to stdout
#   ./pixup-export-nanobot.sh > unpublished.json # Export to file
#   ./pixup-export-nanobot.sh 20                 # Export 20 items (default: 10)
#
# Prerequisites:
#   - PostgreSQL client (psql)
#   - Access to nano_bot database
#
# Environment variables:
#   PGHOST     - Database host (default: localhost)
#   PGPORT     - Database port (default: 5432)
#   PGUSER     - Database user (default: nanobot)
#   PGPASSWORD - Database password
#   PGDATABASE - Database name (default: nanobot)
#

LIMIT="${1:-10}"

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-nanobot}"
PGDATABASE="${PGDATABASE:-nanobot}"

# Query unpublished WowIdeas with required fields
SQL="
SELECT json_agg(row_to_json(t))
FROM (
    SELECT
        image_url,
        prompt,
        title,
        id
    FROM wow_idea
    WHERE instagram_published_at IS NULL
      AND image_url IS NOT NULL
      AND image_url != ''
    ORDER BY created_at DESC
    LIMIT $LIMIT
) t
"

# Execute query
RESULT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -c "$SQL" 2>/dev/null)

# Handle null result (no rows)
if [ -z "$RESULT" ] || [ "$RESULT" = "null" ]; then
    echo "[]"
else
    echo "$RESULT"
fi
