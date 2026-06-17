import { Router } from 'express';
import { listSources, listProjects, getChunks, deleteSource, updateEmbeddings } from '../services/db.js';
import { embedBatched } from '../services/embedding.js';
import { logEvent, recordEmbeddings } from '../services/activity.js';

const router = Router();

// GET /sources — fontes agrupadas por projeto + arquivo
router.get('/', async (req, res, next) => {
  try {
    res.json({ sources: await listSources() });
  } catch (err) {
    next(err);
  }
});

// GET /sources/projects — lista de projetos (pro dropdown do dashboard)
router.get('/projects', async (req, res, next) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (err) {
    next(err);
  }
});

// GET /sources/chunks?project=X&source_path=Y — chunks de uma fonte
router.get('/chunks', async (req, res, next) => {
  try {
    const { project, source_path } = req.query;
    if (!project || !source_path) {
      return res.status(400).json({ error: 'Parâmetros "project" e "source_path" são obrigatórios' });
    }
    res.json({ project, source_path, chunks: await getChunks(project, source_path) });
  } catch (err) {
    next(err);
  }
});

// DELETE /sources — body { project, source_path }
router.delete('/', async (req, res, next) => {
  try {
    const { project, source_path } = req.body || {};
    if (!project || !source_path) {
      return res.status(400).json({ error: 'Campos "project" e "source_path" são obrigatórios' });
    }
    const deleted = await deleteSource(project, source_path);
    logEvent('INFO', 'ingest', `Fonte removida: ${source_path} (${deleted} chunks, projeto ${project})`);
    res.json({ project, source_path, deleted_chunks: deleted });
  } catch (err) {
    next(err);
  }
});

// POST /sources/reindex — re-embeda os chunks existentes de uma fonte
// (útil pra migrar de OpenAI pra Ollama ou vice-versa sem re-upload)
// body: { project, source_path, mode? }
router.post('/reindex', async (req, res, next) => {
  try {
    const { project, source_path, mode } = req.body || {};
    if (!project || !source_path) {
      return res.status(400).json({ error: 'Campos "project" e "source_path" são obrigatórios' });
    }
    const chunks = await getChunks(project, source_path);
    if (!chunks.length) {
      return res.status(404).json({ error: 'Fonte não encontrada' });
    }
    const { embeddings, model, fallback } = await embedBatched(
      chunks.map((c) => c.chunk_text),
      mode
    );
    await updateEmbeddings(
      chunks.map((c, i) => ({ id: c.id, embedding: embeddings[i] })),
      model
    );
    recordEmbeddings(model, chunks.length);
    logEvent('INFO', 'ingest', `Fonte re-indexada: ${source_path} (${chunks.length} chunks via ${model})`);
    res.json({
      project,
      source_path,
      reindexed_chunks: chunks.length,
      embedding_model: model,
      fallback: Boolean(fallback)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
