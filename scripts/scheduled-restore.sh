#!/bin/sh
set -eu
while true; do
  sh /scripts/verify-backup.sh
  date +%s > /tmp/restore-success
  sleep "${BACKUP_VERIFY_INTERVAL_SECONDS:-604800}"
done
