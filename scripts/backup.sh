#!/bin/sh
set -eu
umask 077
mkdir -p /backups
while true; do
    pending=$(mktemp /backups/.pending.XXXXXX)
    if pg_dump --format=custom --file="$pending"; then
        mv "$pending" "/backups/chess-$(date -u +%Y%m%dT%H%M%SZ).dump"
        date +%s > /backups/last-success
        find /backups -maxdepth 1 -type f -name 'chess-*.dump' -mtime +6 -delete
    else
        rm -f "$pending"
        exit 1
    fi
    sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
