import { Router } from 'express';
import { pool, stats } from '../services/db.js';
import { checkOllama } from '../services/embedding.js';
import { getSettings } from '../services/settings.js';
import { getActivitySummary, getQuerySeries } from '../services/activity.js';

const router = Router();

// GET /status — saúde geral: banco, Ollama, OpenAI, contadores, atividade
router.get('/', async (req, res) => {
  const s = getSettings();

  const database = { connected: false };
  let dbStats = null;
  try {
    const v = await pool.query(`
      SELECT current_setting('server_version') AS pg,
             (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector
    `);
    database.connected = true;
    database.version = v.rows[0].pg;
    database.pgvector = v.rows[0].pgvector;
    dbStats = await stats();
  } catch (err) {
    database.error = err.message;
  }

  const ollama = await checkOllama();

  res.json({
    ok: database.connected,
    database,
    stats: dbStats,
    ollama,
    openai: {
      configured: Boolean(s.OPENAI_API_KEY),
      model: s.OPENAI_EMBED_MODEL
    },
    embedding: {
      mode: s.EMBEDDING_MODE,
      dims: s.EMBEDDING_DIMS,
      ollama_model: s.OLLAMA_MODEL,
      effective_provider:
        s.EMBEDDING_MODE === 'openai' ? 'openai'
        : s.EMBEDDING_MODE === 'ollama' ? 'ollama'
        : ollama.online ? 'ollama'
        : s.OPENAI_API_KEY ? 'openai' : 'nenhum'
    },
    activity: getActivitySummary(),
    query_series: getQuerySeries()
  });
});

export default router;
