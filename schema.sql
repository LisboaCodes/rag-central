-- RAG Central — schema do banco (PostgreSQL 17 + pgvector 0.8.x)
-- Rodar no LXC 100 (postgres-db):
--   psql -U postgres -d postgres -f schema.sql
-- Obs.: o backend também cria isso automaticamente no boot (initSchema).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id              BIGSERIAL PRIMARY KEY,
  project         TEXT NOT NULL,
  source_path     TEXT NOT NULL,
  chunk_index     INT  NOT NULL DEFAULT 0,
  chunk_text      TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  -- 1536 dims (padrão OpenAI). Embeddings do Ollama (768) são
  -- preenchidos com zeros até 1536 pelo embedding service.
  embedding       vector(1536),
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- índice HNSW para busca vetorial por cosseno
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw
  ON documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- índice por projeto para filtros
CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project);
