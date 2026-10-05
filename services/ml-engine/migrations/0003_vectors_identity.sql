CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE TABLE IF NOT EXISTS langchain_pg_collection (
    uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL UNIQUE, cmetadata JSON
);
CREATE TABLE IF NOT EXISTS langchain_pg_embedding (
    id VARCHAR PRIMARY KEY, collection_id UUID REFERENCES langchain_pg_collection(uuid) ON DELETE CASCADE,
    embedding public.vector, document VARCHAR, cmetadata JSONB
);
CREATE INDEX IF NOT EXISTS ix_cmetadata_gin ON langchain_pg_embedding USING gin(cmetadata jsonb_path_ops);
INSERT INTO langchain_pg_collection(uuid,name) VALUES(gen_random_uuid(),'chess_games_vector') ON CONFLICT(name) DO NOTHING;
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, fide_id TEXT UNIQUE, federation TEXT, reviewed BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS player_aliases (
    player_id TEXT REFERENCES players(id), alias TEXT NOT NULL, PRIMARY KEY(player_id,alias)
);
CREATE INDEX IF NOT EXISTS idx_player_alias ON player_aliases(alias);
ALTER TABLE ingested_games ADD COLUMN IF NOT EXISTS canonical_id TEXT;
ALTER TABLE ingested_games ADD COLUMN IF NOT EXISTS duplicate_of TEXT;
ALTER TABLE ingested_games ADD COLUMN IF NOT EXISTS played_date TEXT;
ALTER TABLE ingested_games ADD COLUMN IF NOT EXISTS event TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_game_canonical ON ingested_games(canonical_id) WHERE duplicate_of IS NULL;
ALTER TABLE player_moves ADD COLUMN IF NOT EXISTS player_id TEXT REFERENCES players(id);
CREATE INDEX IF NOT EXISTS idx_player_identity_position ON player_moves(player_id,position_key);
CREATE TABLE IF NOT EXISTS game_participants (
    game_id TEXT REFERENCES ingested_games(id) ON DELETE CASCADE, color TEXT NOT NULL, player_id TEXT REFERENCES players(id),
    original_name TEXT NOT NULL, PRIMARY KEY(game_id,color)
);
CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), source_name TEXT NOT NULL, source_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), games INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'running'
);
CREATE TABLE IF NOT EXISTS game_exports (
    game_id TEXT REFERENCES ingested_games(id) ON DELETE CASCADE, batch_id UUID REFERENCES import_batches(id), headers JSONB NOT NULL,
    PRIMARY KEY(game_id,batch_id)
);
CREATE OR REPLACE FUNCTION player_matches(identity TEXT, label TEXT, requested TEXT) RETURNS boolean LANGUAGE SQL STABLE AS $$
 SELECT identity=requested OR (identity IS NULL AND lower(trim(label))=requested)
 OR identity IN (SELECT a.player_id FROM player_aliases a JOIN players p ON p.id=a.player_id WHERE a.alias=requested
   AND ((p.reviewed AND (SELECT count(*) FROM player_aliases b JOIN players r ON r.id=b.player_id WHERE b.alias=requested AND r.reviewed)=1)
   OR ((SELECT count(*) FROM player_aliases WHERE alias=requested)=1)))
$$;
