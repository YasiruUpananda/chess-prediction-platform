#!/bin/sh
set -eu
umask 077
: "${BACKUP_S3_URI:?Set BACKUP_S3_URI to s3://bucket/prefix}"
case "$BACKUP_S3_URI" in s3://*) ;; *) echo 'Use an S3 bucket URI' >&2; exit 1;; esac
backup_directory=${BACKUP_DIRECTORY:-/backups}
state_directory=${UPLOAD_STATE_DIRECTORY:-/upload-state}
while true; do
  for dump in "$backup_directory"/chess-*.dump; do
    test -f "$dump" || continue
    name=$(basename "$dump")
    test ! -f "$state_directory/$name.uploaded" || continue
    if test -n "${AWS_ENDPOINT_URL:-}"; then
      aws --endpoint-url "$AWS_ENDPOINT_URL" s3 cp "$dump" "${BACKUP_S3_URI%/}/$name" --only-show-errors
    else
      aws s3 cp "$dump" "${BACKUP_S3_URI%/}/$name" --only-show-errors
    fi
    date +%s > "$state_directory/$name.uploaded"
    date +%s > "$state_directory/last-success"
  done
  sleep "${BACKUP_UPLOAD_INTERVAL_SECONDS:-300}"
done
