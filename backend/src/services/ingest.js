import { chunkText } from './chunker.js';
import { embedBatched } from './embedding.js';
import { insertChunks, deleteSource } from './db.js';
import { getSettings } from './settings.js';
import { recordIngest, recordEmbeddings, recordOutcome, logEvent } from './activity.js';

// Pipeline único de ingestão (chunk → embed → grava). Reutilizado pela rota
// /ingest e pelo scraper de RSS — pra não duplicar lógica.
export async function ingestText({ project, sourcePath, text, mode, metadata = {}, replace = true, chunkOpts }) {
  if (!project) throw new Error('project é obrigatório');
  if (!text || !String(text).trim()) throw new Error('texto vazio');

  const s = getSettings();
  const opts = chunkOpts || { chunkSize: s.CHUNK_SIZE, overlap: s.CHUNK_OVERLAP, unit: s.CHUNK_UNIT };
  const chunks = chunkText(text, opts);
  if (!chunks.length) return { chunks: 0, replaced: 0, model: null };

  try {
    const { embeddings, model, fallback } = await embedBatched(chunks, mode);
    let replaced = 0;
    if (replace) replaced = await deleteSource(project, sourcePath);
    const ids = await insertChunks({ project, sourcePath, chunks, embeddings, model, metadata });

    recordIngest();
    recordEmbeddings(model, chunks.length);
    recordOutcome(true);
    if (fallback) logEvent('WARN', 'embedding', 'Ollama indisponível — ingestão via fallback OpenAI');
    logEvent('INFO', 'ingest', `Ingestão: ${sourcePath} (${ids.length} chunks, ${model}, projeto ${project})`);

    return { chunks: ids.length, replaced, model, fallback: Boolean(fallback) };
  } catch (err) {
    recordOutcome(false);
    logEvent('ERROR', 'ingest', `Falha na ingestão de ${sourcePath}: ${err.message}`);
    throw err;
  }
}
