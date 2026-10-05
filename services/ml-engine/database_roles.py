"""Provision runtime roles only through the privileged migration job."""
import os
from psycopg import sql

def provision(db):
    grants={
      'api':['schema_migrations','ingested_games','player_moves','players','player_aliases','game_participants','langchain_pg_collection','langchain_pg_embedding','dataset_version','service_heartbeats'],
      'ingestion':['schema_migrations','ingested_games','player_moves','players','player_aliases','game_participants','game_exports','import_batches','langchain_pg_collection','langchain_pg_embedding','dataset_version','service_heartbeats'],
      'ocr':['schema_migrations','ocr_jobs','service_heartbeats','ingested_games'],
      'backup':[],
    }
    for kind,tables in grants.items():
        password=os.getenv('DB_'+kind.upper()+'_PASSWORD')
        if not password: continue
        role='neuro_'+kind
        if not db.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone():
            db.execute(sql.SQL('CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE').format(sql.Identifier(role)))
        db.execute(sql.SQL('ALTER ROLE {} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
        db.execute(sql.SQL('GRANT USAGE ON SCHEMA public TO {}').format(sql.Identifier(role)))
        db.execute(sql.SQL('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {}').format(sql.Identifier(role)))
        db.execute(sql.SQL('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {}').format(sql.Identifier(role)))
        if kind=='backup':
            db.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA public TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(role)))
        else:
            for table in tables:
                permission='SELECT' if kind=='api' or table in ('schema_migrations','langchain_pg_collection') or (kind=='ocr' and table=='ingested_games') else 'SELECT,INSERT,UPDATE,DELETE'
                db.execute(sql.SQL('GRANT '+permission+' ON {} TO {}').format(sql.Identifier(table),sql.Identifier(role)))
            if kind=='api':
                db.execute(sql.SQL('GRANT SELECT,INSERT,UPDATE,DELETE ON saved_studies,request_limits,ocr_jobs TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO {}').format(sql.Identifier(role)))
    # Ingestion runs the version trigger using its own granted UPDATE privilege.
