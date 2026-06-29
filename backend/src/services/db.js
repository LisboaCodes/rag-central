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
  // índice full-text (português) p/ a busca híbrida por palavra-chave
  await pool.query(`CREATE INDEX IF NOT EXISTS documents_fts_idx ON documents USING gin (to_tsvector('portuguese', chunk_text))`);

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
  // marca quantas mensagens já viraram "fato consolidado" (auto-consolidação)
  await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ');
  await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consolidated_msgs INT DEFAULT 0');
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
  // índice full-text (português) p/ a busca híbrida na memória coletiva
  await pool.query(`CREATE INDEX IF NOT EXISTS messages_fts_idx ON messages USING gin (to_tsvector('portuguese', content))`);

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
  // tabela já podia existir sem a coluna — garante colunas novas
  await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS sprite_url TEXT');
  // provedor/modelo por agente (vazio = usa o global das Configurações)
  await pool.query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS chat_provider TEXT DEFAULT 'default'");
  await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS chat_api_base TEXT');
  await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS chat_api_key TEXT');
  await pool.query('ALTER TABLE agents ADD COLUMN IF NOT EXISTS chat_model TEXT');

  // --- tarefas agendadas (CRON) -----------------------------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      schedule    TEXT NOT NULL,            -- expressão cron (5 campos)
      action      TEXT NOT NULL,            -- agent_prompt | rss_sync | brain_digest | consolidate
      config      JSONB DEFAULT '{}',
      enabled     BOOLEAN DEFAULT TRUE,
      last_run_at TIMESTAMPTZ,
      last_status TEXT,                      -- ok | error
      last_result TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // --- Cofre (vault) ----------------------------------------------------
  // Segredos ficam cifrados (AES-256-GCM) em *_enc; a chave deriva da
  // senha-mestra (scrypt) e nunca é persistida. vault_meta guarda só o salt
  // e um verificador para validar a senha-mestra.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vault_meta (
      id          INT PRIMARY KEY DEFAULT 1,
      salt        TEXT NOT NULL,
      verifier    TEXT NOT NULL,            -- texto fixo cifrado p/ checar a senha
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT vault_meta_singleton CHECK (id = 1)
    )
  `);
  // senha-mestra cifrada com VAULT_AGENT_SECRET p/ a IA (DARLENE) operar o cofre
  await pool.query('ALTER TABLE vault_meta ADD COLUMN IF NOT EXISTS agent_master_enc TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vault_accounts (
      id          BIGSERIAL PRIMARY KEY,
      label       TEXT,                     -- apelido (ex: "Gmail pessoal")
      email       TEXT NOT NULL,
      secret_enc  TEXT,                     -- senha do e-mail (cifrada)
      provider    TEXT,                     -- Gmail, Outlook, etc.
      notes_enc   TEXT,                     -- anotações (cifradas)
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vault_services (
      id            BIGSERIAL PRIMARY KEY,
      account_id    BIGINT REFERENCES vault_accounts(id) ON DELETE SET NULL,
      name          TEXT NOT NULL,          -- nome do serviço (Netflix, AWS…)
      login         TEXT,                   -- usuário/login do serviço
      secret_enc    TEXT,                   -- senha do serviço (cifrada)
      url           TEXT,
      category      TEXT,
      cost          NUMERIC,                -- valor do serviço
      currency      TEXT DEFAULT 'BRL',
      billing_cycle TEXT,                   -- monthly | yearly | once | weekly
      started_on    DATE,                   -- data de criação/contratação
      expires_on    DATE,                   -- vencimento/renovação
      notes_enc     TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS vault_services_account_idx ON vault_services (account_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS vault_services_expires_idx ON vault_services (expires_on)');

  await seedAgents();
}

// --- Cofre: meta + CRUD (segredos vêm/voltam cifrados; cripto no vault.js) ---

export async function getVaultMeta() {
  const { rows } = await pool.query('SELECT * FROM vault_meta WHERE id = 1');
  return rows[0] || null;
}

export async function setVaultMeta(salt, verifier) {
  await pool.query(
    `INSERT INTO vault_meta (id, salt, verifier) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET salt = EXCLUDED.salt, verifier = EXCLUDED.verifier`,
    [salt, verifier]
  );
}

export async function setVaultAgentMaster(enc) {
  await pool.query('UPDATE vault_meta SET agent_master_enc = $1 WHERE id = 1', [enc]);
}

export async function listVaultAccounts() {
  const { rows } = await pool.query('SELECT * FROM vault_accounts ORDER BY label, email');
  return rows;
}

export async function findVaultAccountByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM vault_accounts WHERE lower(email) = lower($1) LIMIT 1', [String(email || '')]);
  return rows[0] || null;
}

export async function getVaultAccount(id) {
  const { rows } = await pool.query('SELECT * FROM vault_accounts WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createVaultAccount(a) {
  const { rows } = await pool.query(
    `INSERT INTO vault_accounts (label, email, secret_enc, provider, notes_enc)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [a.label || null, a.email, a.secret_enc || null, a.provider || null, a.notes_enc || null]
  );
  return rows[0];
}

export async function updateVaultAccount(id, patch) {
  const fields = ['label', 'email', 'secret_enc', 'provider', 'notes_enc'];
  const sets = []; const vals = [];
  for (const f of fields) if (patch[f] !== undefined) { vals.push(patch[f]); sets.push(`${f} = $${vals.length}`); }
  if (!sets.length) return getVaultAccount(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE vault_accounts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`, vals
  );
  return rows[0] || null;
}

export async function deleteVaultAccount(id) {
  const res = await pool.query('DELETE FROM vault_accounts WHERE id = $1', [id]);
  return res.rowCount;
}

export async function listVaultServices() {
  const { rows } = await pool.query('SELECT * FROM vault_services ORDER BY name');
  return rows;
}

export async function getVaultService(id) {
  const { rows } = await pool.query('SELECT * FROM vault_services WHERE id = $1', [id]);
  return rows[0] || null;
}

const SERVICE_FIELDS = ['account_id', 'name', 'login', 'secret_enc', 'url', 'category',
  'cost', 'currency', 'billing_cycle', 'started_on', 'expires_on', 'notes_enc'];

export async function createVaultService(s) {
  const cols = []; const ph = []; const vals = [];
  for (const f of SERVICE_FIELDS) {
    cols.push(f); vals.push(s[f] === undefined ? null : s[f]); ph.push(`$${vals.length}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO vault_services (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`, vals
  );
  return rows[0];
}

export async function updateVaultService(id, patch) {
  const sets = []; const vals = [];
  for (const f of SERVICE_FIELDS) if (patch[f] !== undefined) { vals.push(patch[f]); sets.push(`${f} = $${vals.length}`); }
  if (!sets.length) return getVaultService(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE vault_services SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`, vals
  );
  return rows[0] || null;
}

export async function deleteVaultService(id) {
  const res = await pool.query('DELETE FROM vault_services WHERE id = $1', [id]);
  return res.rowCount;
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
    `INSERT INTO agents (key, name, role, bio, persona, model, color, gender, avatar_url, sprite_url, sort_order,
                         chat_provider, chat_api_base, chat_api_key, chat_model)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [key, a.name || key, a.role || null, a.bio || null, a.persona || null,
     a.model || null, a.color || 'blue', a.gender || null, a.avatar_url || null, a.sprite_url || null, a.sort_order ?? 100,
     a.chat_provider || 'default', a.chat_api_base || null, a.chat_api_key || null, a.chat_model || null]
  );
  return rows[0];
}

export async function updateAgent(key, patch) {
  const fields = ['name', 'role', 'bio', 'persona', 'model', 'color', 'gender', 'avatar_url', 'sprite_url', 'sort_order',
    'chat_provider', 'chat_api_base', 'chat_api_key', 'chat_model'];
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

// Busca por PALAVRA-CHAVE (full-text português) em documentos. Complementa a
// busca vetorial na busca híbrida: pega termos exatos, nomes próprios, siglas
// e IDs que o embedding sozinho tende a perder. websearch_to_tsquery aceita
// linguagem natural (aspas, -negação) e nunca lança em texto solto.
export async function searchDocumentsKeyword({ query, model, project, topK = 20, matchModel = true }) {
  if (!query || !query.trim()) return [];
  const params = [query];
  const where = [`to_tsvector('portuguese', chunk_text) @@ websearch_to_tsquery('portuguese', $1)`];
  if (matchModel && model) { params.push(model); where.push(`embedding_model = $${params.length}`); }
  if (project) { params.push(project); where.push(`project = $${params.length}`); }
  params.push(topK);
  const res = await pool.query(
    `SELECT id, project, source_path, chunk_index, chunk_text, metadata,
            embedding_model, created_at,
            ts_rank(to_tsvector('portuguese', chunk_text), websearch_to_tsquery('portuguese', $1)) AS rank
     FROM documents
     WHERE ${where.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({ ...r, rank: Number(r.rank), similarity: null }));
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

// memória de longo prazo: mensagens semanticamente parecidas.
// agent=null → CÉREBRO COLETIVO: recupera de TODOS os agentes (cada origem é
// marcada no recall). Passando agent=X restringe a um agente específico.
export async function searchMessages({ embedding, model, agent, excludeConversationId, topK = 4, matchModel = true }) {
  const params = [toVectorLiteral(embedding)];
  const where = ['embedding IS NOT NULL'];
  if (matchModel && model) { params.push(model); where.push(`embedding_model = $${params.length}`); }
  if (agent) { params.push(agent); where.push(`agent = $${params.length}`); }
  if (excludeConversationId) { params.push(excludeConversationId); where.push(`conversation_id <> $${params.length}`); }
  params.push(topK);
  const res = await pool.query(
    `SELECT id, content, agent, conversation_id, created_at,
            1 - (embedding <=> $1::vector) AS similarity
     FROM messages
     WHERE ${where.join(' AND ')}
     ORDER BY embedding <=> $1::vector
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

// Versão por PALAVRA-CHAVE da memória coletiva (full-text português). agent=null
// → busca em todos os agentes; exclui a conversa atual como o vetorial faz.
export async function searchMessagesKeyword({ query, agent, excludeConversationId, topK = 20 }) {
  if (!query || !query.trim()) return [];
  const params = [query];
  const where = [`to_tsvector('portuguese', content) @@ websearch_to_tsquery('portuguese', $1)`, 'embedding IS NOT NULL'];
  if (agent) { params.push(agent); where.push(`agent = $${params.length}`); }
  if (excludeConversationId) { params.push(excludeConversationId); where.push(`conversation_id <> $${params.length}`); }
  params.push(topK);
  const res = await pool.query(
    `SELECT id, content, agent, conversation_id, created_at,
            ts_rank(to_tsvector('portuguese', content), websearch_to_tsquery('portuguese', $1)) AS rank
     FROM messages
     WHERE ${where.join(' AND ')}
     ORDER BY rank DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map((r) => ({ ...r, rank: Number(r.rank), similarity: null }));
}

// --- CENTRAL DE MEMÓRIA ----------------------------------------------------
// Visão unificada de tudo que foi "aprendido": documentos ingeridos, fatos
// consolidados (memoria-consolidada), notas de agentes (memoria-agentes) e as
// mensagens das conversas. Cada item tem um uid 'doc:<id>' ou 'msg:<id>' que
// as rotas de editar/excluir usam pra saber em qual tabela mexer.
const MEM_CTE = `
  WITH mem AS (
    SELECT 'doc:' || id AS uid, id, 'documents' AS store,
      CASE project
        WHEN 'memoria-consolidada' THEN 'fato'
        WHEN 'memoria-agentes'     THEN 'nota'
        ELSE 'documento'
      END AS kind,
      project, source_path AS ref, chunk_index, chunk_text AS text,
      COALESCE(NULLIF(metadata->>'by',''), NULLIF(metadata->>'agent','')) AS agent,
      embedding_model AS model, created_at, updated_at
    FROM documents
    UNION ALL
    SELECT 'msg:' || id AS uid, id, 'messages' AS store,
      'mensagem' AS kind,
      NULL AS project, 'conversa #' || conversation_id AS ref, 0 AS chunk_index, content AS text,
      COALESCE(agent, CASE WHEN role = 'user' THEN 'Usuário' ELSE 'Equipe' END) AS agent,
      embedding_model AS model, created_at, created_at AS updated_at
    FROM messages
  )
`;

export async function listMemory({ kind, project, agent, q, limit = 60, offset = 0 } = {}) {
  const params = [kind || null, project || null, agent || null, q ? `%${q}%` : null, limit, offset];
  const res = await pool.query(
    `${MEM_CTE}
     SELECT uid, id, store, kind, project, ref, chunk_index, text, agent, model, created_at, updated_at
     FROM mem
     WHERE ($1::text IS NULL OR kind = $1)
       AND ($2::text IS NULL OR project = $2)
       AND ($3::text IS NULL OR agent = $3)
       AND ($4::text IS NULL OR text ILIKE $4)
     ORDER BY created_at DESC
     LIMIT $5 OFFSET $6`,
    params
  );
  const total = await pool.query(
    `${MEM_CTE}
     SELECT COUNT(*)::int AS n FROM mem
     WHERE ($1::text IS NULL OR kind = $1)
       AND ($2::text IS NULL OR project = $2)
       AND ($3::text IS NULL OR agent = $3)
       AND ($4::text IS NULL OR text ILIKE $4)`,
    [kind || null, project || null, agent || null, q ? `%${q}%` : null]
  );
  return { items: res.rows, total: total.rows[0].n };
}

// valores distintos pra montar os filtros (tipo, projeto, agente) com contagem
export async function memoryFacets() {
  const kinds = await pool.query(`${MEM_CTE} SELECT kind, COUNT(*)::int AS n FROM mem GROUP BY kind ORDER BY n DESC`);
  const projects = await pool.query(`${MEM_CTE} SELECT project, COUNT(*)::int AS n FROM mem WHERE project IS NOT NULL GROUP BY project ORDER BY n DESC`);
  const agents = await pool.query(`${MEM_CTE} SELECT agent, COUNT(*)::int AS n FROM mem WHERE agent IS NOT NULL GROUP BY agent ORDER BY n DESC`);
  return { kinds: kinds.rows, projects: projects.rows, agents: agents.rows };
}

// estatísticas do "cérebro" pro dashboard: total, por tipo e curva de
// crescimento (total acumulado por dia nos últimos 14 dias).
export async function memoryStats() {
  const kinds = await pool.query(`${MEM_CTE} SELECT kind, COUNT(*)::int AS n FROM mem GROUP BY kind`);
  const total = kinds.rows.reduce((s, r) => s + r.n, 0);
  const series = await pool.query(`
    WITH allmem AS (
      SELECT created_at FROM documents
      UNION ALL
      SELECT created_at FROM messages
    ), days AS (
      SELECT generate_series((CURRENT_DATE - INTERVAL '13 days')::date, CURRENT_DATE, '1 day')::date AS d
    )
    SELECT to_char(d, 'YYYY-MM-DD') AS date,
           (SELECT COUNT(*)::int FROM allmem WHERE created_at::date <= d) AS total
    FROM days ORDER BY d
  `);
  return { total, by_kind: kinds.rows, series: series.rows };
}

// edita o texto de UM item (re-embeda fora, aqui só grava). store = 'documents' | 'messages'
export async function updateMemoryText({ store, id, text, embedding, model }) {
  const vec = embedding ? toVectorLiteral(embedding) : null;
  if (store === 'documents') {
    const res = await pool.query(
      `UPDATE documents
       SET chunk_text = $1, embedding = COALESCE($2::vector, embedding),
           embedding_model = COALESCE($3, embedding_model), updated_at = NOW()
       WHERE id = $4 RETURNING id`,
      [text, vec, model, id]
    );
    return res.rowCount;
  }
  const res = await pool.query(
    `UPDATE messages
     SET content = $1, embedding = COALESCE($2::vector, embedding),
         embedding_model = COALESCE($3, embedding_model)
     WHERE id = $4 RETURNING id`,
    [text, vec, model, id]
  );
  return res.rowCount;
}

export async function deleteMemoryRow({ store, id }) {
  const table = store === 'documents' ? 'documents' : 'messages';
  const res = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return res.rowCount;
}

// estado de consolidação de uma conversa (pra auto-consolidação)
export async function getConsolidationState(conversationId) {
  const res = await pool.query(
    `SELECT c.consolidated_msgs,
            (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id) AS total
     FROM conversations c WHERE c.id = $1`,
    [conversationId]
  );
  const row = res.rows[0] || { consolidated_msgs: 0, total: 0 };
  return { consolidated: row.consolidated_msgs || 0, total: row.total || 0 };
}

export async function markConsolidated(conversationId, count) {
  await pool.query(
    'UPDATE conversations SET consolidated_at = NOW(), consolidated_msgs = $2 WHERE id = $1',
    [conversationId, count]
  );
}

// --- tarefas agendadas (CRON) ----------------------------------------------
export async function listCronJobs() {
  const { rows } = await pool.query('SELECT * FROM cron_jobs ORDER BY created_at DESC');
  return rows;
}

export async function getCronJob(id) {
  const { rows } = await pool.query('SELECT * FROM cron_jobs WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function createCronJob({ name, schedule, action, config = {}, enabled = true }) {
  const { rows } = await pool.query(
    `INSERT INTO cron_jobs (name, schedule, action, config, enabled)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [name, schedule, action, JSON.stringify(config), enabled]
  );
  return rows[0];
}

export async function updateCronJob(id, patch) {
  const fields = ['name', 'schedule', 'action', 'config', 'enabled'];
  const sets = [], vals = [];
  for (const f of fields) {
    if (patch[f] !== undefined) {
      vals.push(f === 'config' ? JSON.stringify(patch[f]) : patch[f]);
      sets.push(`${f} = $${vals.length}`);
    }
  }
  if (!sets.length) return getCronJob(id);
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE cron_jobs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  return rows[0] || null;
}

export async function deleteCronJob(id) {
  const r = await pool.query('DELETE FROM cron_jobs WHERE id = $1', [id]);
  return r.rowCount;
}

export async function markCronRun(id, status, result) {
  await pool.query(
    'UPDATE cron_jobs SET last_run_at = NOW(), last_status = $2, last_result = $3 WHERE id = $1',
    [id, status, String(result || '').slice(0, 1000)]
  );
}

// busca UM item de memória pelo uid ('doc:123' | 'msg:45') — usado pra abrir
// direto na edição vindo do grafo.
export async function getMemoryItem(uid) {
  const res = await pool.query(
    `${MEM_CTE}
     SELECT uid, id, store, kind, project, ref, chunk_index, text, agent, model, created_at, updated_at
     FROM mem WHERE uid = $1`,
    [uid]
  );
  return res.rows[0] || null;
}

// --- GRAFO DO CÉREBRO ------------------------------------------------------
// Nós = chunks da base (conhecimento + fatos + notas) e, opcionalmente, as
// mensagens cruas das conversas. Arestas = similaridade semântica: pra cada
// nó, seus vizinhos mais próximos (mesmo modelo de embedding) acima de um
// limiar de cosseno. É o que dá o aspecto "teia de neurônios".
function docLabel(d) {
  const base = String(d.source_path || '').split('/').pop();
  if (base && base !== 'undefined') return base.replace(/\.(md|txt|pdf|json)$/i, '');
  return String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export async function memoryGraph({ project, limit = 200, neighbors = 4, threshold = 0.72, includeMessages = false, msgLimit = 150 } = {}) {
  const docRes = await pool.query(
    `SELECT 'doc:' || id AS uid, id, 'documents' AS store, project, source_path,
            chunk_text AS text, embedding_model AS model,
            COALESCE(NULLIF(metadata->>'by',''), NULLIF(metadata->>'agent','')) AS agent,
            CASE project
              WHEN 'memoria-consolidada' THEN 'fato'
              WHEN 'memoria-agentes'     THEN 'nota'
              ELSE 'documento'
            END AS kind,
            created_at
     FROM documents
     WHERE embedding IS NOT NULL
       AND ($1::text IS NULL OR project = $1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [project || null, limit]
  );
  const nodes = docRes.rows.map((r) => ({ ...r, label: docLabel(r) }));

  // mensagens só entram quando não há filtro por projeto (elas não têm projeto)
  const withMsgs = includeMessages && !project;
  if (withMsgs) {
    const msgRes = await pool.query(
      `SELECT 'msg:' || id AS uid, id, 'messages' AS store, NULL AS project, NULL AS source_path,
              content AS text, embedding_model AS model,
              COALESCE(agent, CASE WHEN role = 'user' THEN 'Usuário' ELSE 'Equipe' END) AS agent,
              'mensagem' AS kind, conversation_id, created_at
       FROM messages
       WHERE embedding IS NOT NULL
       ORDER BY created_at DESC
       LIMIT $1`,
      [msgLimit]
    );
    for (const r of msgRes.rows) nodes.push({ ...r, label: `conversa #${r.conversation_id}` });
  }
  if (!nodes.length) return { nodes: [], links: [] };

  const docIds = docRes.rows.map((r) => r.id);
  const msgIds = withMsgs ? nodes.filter((n) => n.store === 'messages').map((n) => n.id) : [];
  const edgesRes = await pool.query(
    `WITH sel AS (
       SELECT 'doc:' || id AS uid, embedding, embedding_model FROM documents WHERE id = ANY($1::bigint[])
       UNION ALL
       SELECT 'msg:' || id AS uid, embedding, embedding_model FROM messages WHERE id = ANY($2::bigint[]) AND embedding IS NOT NULL
     )
     SELECT a.uid AS source, b.uid AS target, 1 - (a.embedding <=> b.embedding) AS sim
     FROM sel a
     JOIN LATERAL (
       SELECT s.uid, s.embedding FROM sel s
       WHERE s.uid <> a.uid AND s.embedding_model = a.embedding_model
       ORDER BY a.embedding <=> s.embedding
       LIMIT $3
     ) b ON true
     WHERE 1 - (a.embedding <=> b.embedding) >= $4`,
    [docIds, msgIds, neighbors, threshold]
  );

  // dedup a-b / b-a (fica a maior similaridade)
  const seen = new Map();
  for (const e of edgesRes.rows) {
    const sim = Number(e.sim);
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    if (!seen.has(key) || seen.get(key).sim < sim) seen.set(key, { source: e.source, target: e.target, sim });
  }
  return { nodes, links: [...seen.values()] };
}
