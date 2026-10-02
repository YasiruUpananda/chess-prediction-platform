#!/bin/sh
# Restore only into a new disposable database, never the application database.
set -eu
dump=$(find /backups -maxdepth 1 -name 'chess-*.dump' -type f | sort | tail -n 1)
test -n "$dump"
target="backup_restore_check_$(date +%s)_$$"
trap 'dropdb --if-exists "$target"' EXIT
createdb "$target"
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$target" "$dump"
psql --dbname="$target" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS restored_indexed_games FROM ingested_games WHERE indexed;'
echo 'Backup restored successfully into a disposable database.'
