import { Router } from 'express';
import { embed } from '../services/embedding.js';
import { searchSimilar } from '../services/db.js';
import { logEvent, recordQuery, recordOutcome, recordEmbeddings } from '../services/activity.js';

const router = Router();

/**
 * POST /query
 * body: {
 *   question:   string  (obrigatório)
 *   project:    string  (opcional — filtra escopo)
 *   agent:      string  (opcional — nome do agente, p/ estatísticas)
 *   top_k:      number  (opcional, default 5, máx 50)
 *   mode:       'auto'|'ollama'|'openai' (opcional — override pontual)
 *   match_model: boolean (opcional, default true — só compara chunks
 *                gerados pelo mesmo modelo de embedding da pergunta)
 * }
 */
router.post('/', async (req, res, next) => {
  const { question, project, agent, top_k, mode, match_model } = req.body || {};
  try {
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Campo "question" é obrigatório' });
    }
    const topK = Math.min(Math.max(parseInt(top_k, 10) || 5, 1), 50);

    const { embeddings, model, fallback } = await embed([question.trim()], mode);
    const results = await searchSimilar({
      embedding: embeddings[0],
      model,
      project: project || null,
      topK,
      matchModel: match_model !== false
    });

    recordQuery(agent);
    recordEmbeddings(model, 1);
    recordOutcome(true);
    if (fallback) {
      logEvent('WARN', 'embedding', 'Ollama indisponível — fallback OpenAI acionado na query');
    }
    logEvent(
      'INFO',
      'query',
      `${agent ? String(agent).toUpperCase() : 'anônimo'}: "${question.trim().slice(0, 80)}" → ${results.length} resultados` +
        (results[0] ? ` (top score ${results[0].similarity.toFixed(2)})` : '')
    );

    res.json({
      question: question.trim(),
      project: project || null,
      agent: agent || null,
      top_k: topK,
      embedding_model: model,
      fallback: Boolean(fallback),
      count: results.length,
      results
    });
  } catch (err) {
    recordOutcome(false);
    logEvent('ERROR', 'query', `Falha na query "${String(question || '').slice(0, 60)}": ${err.message}`);
    next(err);
  }
});

export default router;
