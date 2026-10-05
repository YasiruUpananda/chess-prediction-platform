# Off-host backups

Create a private S3-compatible bucket in your chosen provider. Enable encryption,
versioning and a retention policy (for example 30 days). Create credentials restricted
to uploading objects in the backup prefix; do not allow public access. These are manual
provider/account steps. This repository does not provision or charge a cloud account.

Add these values to your untracked `.env`:

```dotenv
BACKUP_S3_URI=s3://your-private-bucket/neurochess
BACKUP_ACCESS_KEY_ID=your-key
BACKUP_SECRET_ACCESS_KEY=your-secret
BACKUP_REGION=us-east-1
# Leave empty for AWS; set your provider HTTPS endpoint for other S3 services.
BACKUP_ENDPOINT_URL=
DB_API_PASSWORD=separate-api-password
DB_INGESTION_PASSWORD=separate-ingestion-password
DB_OCR_PASSWORD=separate-ocr-password
DB_BACKUP_PASSWORD=separate-readonly-backup-password
```

Start the local dump scheduler, uploader and weekly restore checker:

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml -f docker-compose.backups.yml --profile backup --profile offsite-backup up -d --build
```

Uploads retry after a process restart; a marker is written only after the CLI reports
success. Dumps are read-only in the upload container. The restore checker uses an
administrative connection exclusively to create and drop a new disposable database;
the ordinary backup container has read-only database access. Start it after a first
dump exists. Monitor its health and the uploader logs; credentials alone do not prove
an upload or restore occurred.

Periodically download a dump from the bucket to a separate host and restore it there.
The scheduled local check validates database restoreability, not off-host recovery.
Store deployment configuration and the PGN source corpus separately: pg_dump does not
back up those files. See [AWS CLI S3 copy](https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html)
for endpoint and transfer behavior.
