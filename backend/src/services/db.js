import pg from 'pg';
import { getSetting } from './settings.js';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[db] erro inesperado no pool:', err.message);
});

// pgvector aceita o vetor como literal de texto '[1,2,3]' com cast ::vector
export function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

export async function initSchema() {
  const dims = getSetting('EMBEDDING_DIMS');
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id              BIGSERIAL PRIMARY KEY,
      project         TEXT NOT NULL,
      source_path     TEXT NOT NULL,
      chunk_index     INT  NOT NULL DEFAULT 0,
      chunk_text      TEXT NOT NULL,
      metadata        JSONB DEFAULT '{}',
      embedding       vector(${dims}),
      embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS documents_embedding_hnsw
      ON documents USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS documents_project_idx ON documents (project)');

  // --- memória de conversas (o "cérebro") -------------------------------
  // Uma conversa é uma thread. agent = nome do agente (MEL…) ou 'GROUP'
  // para a sala coletiva (agente-a-agente).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          BIGSERIAL PRIMARY KEY,
      agent       TEXT NOT NULL,
      title       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,            -- 'user' | 'assistant'
      agent           TEXT,                     -- qual agente falou (se assistant)
      content         TEXT NOT NULL,
      embedding       vector(${dims}),          -- memória semântica
      embedding_model TEXT,
      metadata        JSONB DEFAULT '{}',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS messages_agent_idx ON messages (agent)');
  await pool.query(`
    CREATE INDEX IF NOT EXISTS messages_embedding_hnsw
      ON messages USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  `);

  // --- agentes (editáveis/criáveis) -------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id          BIGSERIAL PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,   -- nome em MAIÚSCULAS (mentions/telemetria)
      name        TEXT NOT NULL,
      role        TEXT,                   -- função / o que faz
      bio         TEXT,
      persona     TEXT,                   -- particularidades / system prompt
      model       TEXT,                   -- rótulo do modelo (exibição)
      color       TEXT DEFAULT 'blue',
      gender      TEXT,
      avatar_url  TEXT,
      sprite_url  TEXT,
      sort_order  INT DEFAULT 100,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // tabela já podia existir sem a coluna — garante o sprite_url
  await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS sprite_url TEXT');
  await seedAgents();
}

// Semeia os 4 agentes originais na primeira vez (tabela vazia).
async function seedAgents() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM agents');
  if (rows[0].n > 0) return;
  const seed = [
    { key: 'MEL', name: 'MEL', role: 'Engenheira Chefe', model: 'Claude Sonnet 4.6', color: 'purple', gender: 'feminino',
      bio: 'Engenheira de software chefe da equipe.',
      persona: 'Você é a MEL, engenheira de software chefe. Fala de forma técnica, direta e objetiva. Foca em arquitetura, qualidade de código, infraestrutura e boas práticas. Não enrola.' },
    { key: 'MARKZUCK', name: 'MARKZUCK', role: 'Especialista em Tráfego Pago', model: 'Claude Opus 4.8', color: 'green', gender: 'masculino',
      bio: 'Especialista em mídia de performance e growth.',
      persona: 'Você é o MARKZUCK, especialista em tráfego pago e mídia de performance. Pensa em ROI, CAC, ROAS, criativos e otimização de campanhas (Meta/Google Ads). Fala como growth marketer focado em resultado.' },
    { key: 'DARLENE', name: 'DARLENE', role: 'Secretária Executiva', model: 'GPT-5.5', color: 'gold', gender: 'feminino',
      bio: 'Secretária executiva, organização e coordenação.',
      persona: 'Você é a DARLENE, secretária executiva. Organizada, cordial e prática. Ajuda com agenda, coordenação, resumos, follow-ups e comunicação. Tom profissional e gentil.' },
    { key: 'JOANNA', name: 'JOANNA', role: 'Social Media', model: 'DeepSeek', color: 'blue', gender: 'feminino',
      bio: 'Social media, conteúdo e tendências.',
      persona: 'Você é a JOANNA, social media. Criativa, descolada e antenada em tendências. Ajuda com ideias de conteúdo, copy, calendário editorial e redes sociais. Tom leve e criativo, mas profissional.' }
  ];
  for (let i = 0; i < seed.length; i++) {
    const a = seed[i];
    await pool.query(
      `INSERT INTO agents (key, name, role, bio, persona, model, color, gender, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (key) DO NOTHING`,
      [a.key, a.name, a.role, a.bio, a.persona, a.model, a.color, a.gender, i]
    );
  }
}

// --- CRUD de agentes -------------------------------------------------------

export async function listAgents() {
  const { rows } = await pool.query('SELECT * FROM agents ORDER BY sort_order, name');
  return rows;
}

export async function getAgent(key) {
  const { rows } = await pool.query('SELECT * FROM agents WHERE key = $1', [String(key || '').toUpperCase()]);
  return rows[0] || null;
}

export async function createAgent(a) {
  const key = String(a.key || a.name || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!key) throw new Error('nome/key obrigatório');
  const { rows } = await pool.query(
    `INSERT INTO agents (key, name, role, bio, persona, model, color, gender, avatar_url, sprite_url, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [key, a.name || key, a.role || null, a.bio || null, a.persona || null,
     a.model || null, a.color || 'blue', a.gender || null, a.avatar_url || null, a.sprite_url || null, a.sort_order ?? 100]
  );
  return rows[0];
}

export async function updateAgent(key, patch) {
  const fields = ['name', 'role', 'bio', 'persona', 'model', 'color', 'gender', 'avatar_url', 'sprite_url', 'sort_order'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (patch[f] !== undefined) { vals.push(patch[f]); sets.push(`${f} = $${vals.length}`); }
  }
  if (!sets.length) return getAgent(key);
  vals.push(String(key).toUpperCase());
  const { rows } = await pool.query(
    `UPDATE agents SET ${sets.join(', ')}, updated_at = NOW() WHERE key = $${vals.length} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function deleteAgent(key) {
  const res = await pool.query('DELETE FROM agents WHERE key = $1', [String(key).toUpperCase()]);
  return res.rowCount;
}

export async function insertChunks({ project, sourcePath, chunks, embeddings, model, metadata = {} }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [];
    for (let i = 0; i < chunks.length; i++) {
      const res = await client.query(
        `INSERT INTO documents (project, source_path, chunk_index, chunk_text, metadata, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
         RETURNING id`,
        [project, sourcePath, i, chunks[i], JSON.stringify(metadata), toVectorLiteral(embeddings[i]), model]
      );
      ids.push(res.rows[0].id);
    }
    await client.query('COMMIT');
    return ids;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function searchSimilar({ embedding, model, project, topK = 5, matchModel = true }) {
  const params = [toVectorLiteral(embedding)];
  const where = [];
  if (matchModel) {
    // comparar vetores de modelos diferentes não faz sentido semântico,
    // então por padrão a busca só olha chunks do mesmo modelo da pergunta
    params.push(model);
    where.push(`embedding_model = $${params.length}`);
  }
  if (project) {
    params.push(project);
    where.push(`project = $${params.length}`);
  }
  params.push(topK);
  const res = await pool.query(
    `SELECT id, project, source_path, chunk_index, chunk_text, metadata,
            embedding_model, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM documents
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY embedding <=> $1::vector
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

export async function listSources() {
  const res = await pool.query(`
    SELECT project, source_path,
           COUNT(*)::int AS chunks,
           STRING_AGG(DISTINCT embedding_model, ', ') AS embedding_models,
           MAX(created_at) AS last_ingested_at
    FROM documents
    GROUP BY project, source_path
    ORDER BY MAX(created_at) DESC
  `);
  return res.rows;
}

export async function listProjects() {
  const res = await pool.query('SELECT DISTINCT project FROM documents ORDER BY project');
  return res.rows.map((r) => r.project);
}

export async function getChunks(project, sourcePath) {
  const res = await pool.query(
    `SELECT id, chunk_index, chunk_text, metadata, embedding_model, created_at, updated_at
     FROM documents
     WHERE project = $1 AND source_path = $2
     ORDER BY chunk_index`,
    [project, sourcePath]
  );
  return res.rows;
}

export async function deleteSource(project, sourcePath) {
  const res = await pool.query(
    'DELETE FROM documents WHERE project = $1 AND source_path = $2',
    [project, sourcePath]
  );
  return res.rowCount;
}

export async function updateEmbeddings(rows, model) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { id, embedding } of rows) {
      await client.query(
        `UPDATE documents
         SET embedding = $1::vector, embedding_model = $2, updated_at = NOW()
         WHERE id = $3`,
        [toVectorLiteral(embedding), model, id]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function stats() {
  const res = await pool.query(`
    SELECT COUNT(*)::int AS total_chunks,
           COUNT(DISTINCT project)::int AS projects,
           COUNT(DISTINCT (project, source_path))::int AS sources,
           MAX(created_at) AS last_ingested_at
    FROM documents
  `);
  const byModel = await pool.query(`
    SELECT embedding_model, COUNT(*)::int AS chunks
    FROM documents
    GROUP BY embedding_model
    ORDER BY chunks DESC
  `);
  const byProject = await pool.query(`
    SELECT project, COUNT(*)::int AS chunks
    FROM documents
    GROUP BY project
    ORDER BY chunks DESC
    LIMIT 5
  `);
  const byType = await pool.query(`
    SELECT COALESCE(NULLIF(metadata->>'type', ''), 'outros') AS type, COUNT(*)::int AS chunks
    FROM documents
    GROUP BY 1
    ORDER BY chunks DESC
  `);
  return {
    ...res.rows[0],
    by_model: byModel.rows,
    by_project: byProject.rows,
    by_type: byType.rows
  };
}

// --- conversas & memória ---------------------------------------------------

export async function createConversation(agent, title = null) {
  const res = await pool.query(
    'INSERT INTO conversations (agent, title) VALUES ($1, $2) RETURNING *',
    [agent, title]
  );
  return res.rows[0];
}

export async function listConversations(agent) {
  const params = [];
  let where = '';
  if (agent) { params.push(agent); where = 'WHERE c.agent = $1'; }
  const res = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count,
            (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message
     FROM conversations c
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT 100`,
    params
  );
  return res.rows;
}

export async function getConversation(id) {
  const conv = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
  if (!conv.rows[0]) return null;
  const msgs = await pool.query(
    `SELECT id, role, agent, content, metadata, created_at
     FROM messages WHERE conversation_id = $1 ORDER BY created_at`,
    [id]
  );
  return { ...conv.rows[0], messages: msgs.rows };
}

export async function deleteConversation(id) {
  const res = await pool.query('DELETE FROM conversations WHERE id = $1', [id]);
  return res.rowCount;
}

export async function getRecentMessages(conversationId, limit = 12) {
  const res = await pool.query(
    `SELECT role, agent, content FROM messages
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return res.rows.reverse();
}

export async function insertMessage({ conversationId, role, agent, content, embedding, model, metadata = {} }) {
  const res = await pool.query(
    `INSERT INTO messages (conversation_id, role, agent, content, embedding, embedding_model, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [
      conversationId,
      role,
      agent || null,
      content,
      embedding ? toVectorLiteral(embedding) : null,
      model || null,
      JSON.stringify(metadata)
    ]
  );
  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);
  return res.rows[0];
}

// memória de longo prazo: mensagens semanticamente parecidas do mesmo agente,
// excluindo a conversa atual (pra trazer contexto de OUTRAS conversas).
export async function searchMessages({ embedding, model, agent, excludeConversationId, topK = 4, matchModel = true }) {
  const params = [toVectorLiteral(embedding)];
  const where = ['embedding IS NOT NULL'];
  if (matchModel && model) { params.push(model); where.push(`embedding_model = $${params.length}`); }
  if (agent) { params.push(agent); where.push(`agent = $${params.length}`); }
  if (excludeConversationId) { params.push(excludeConversationId); where.push(`conversation_id <> $${params.length}`); }
  params.push(topK);
  const res = await pool.query(
    `SELECT content, agent, conversation_id, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM messages
     WHERE ${where.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}
