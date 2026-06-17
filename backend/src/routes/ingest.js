import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { chunkText } from '../services/chunker.js';
import { embedBatched } from '../services/embedding.js';
import { insertChunks, deleteSource } from '../services/db.js';
import { getSettings } from '../services/settings.js';
import { logEvent, recordIngest, recordOutcome, recordEmbeddings } from '../services/activity.js';

const router = Router();

const TEXT_EXTENSIONS = [
  '.md', '.txt', '.py', '.js', '.ts', '.jsx', '.tsx', '.php',
  '.json', '.yml', '.yaml', '.sql', '.sh', '.env', '.ini', '.conf',
  '.html', '.css', '.csv', '.xml', '.toml'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf' || TEXT_EXTENSIONS.includes(ext)) return cb(null, true);
    cb(new Error(`Extensão não suportada: ${ext || file.originalname}`));
  }
});

async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf') {
    const parsed = await pdfParse(file.buffer);
    return parsed.text;
  }
  return file.buffer.toString('utf8');
}

// Aceita multipart (campo "file") ou JSON { text, source_path }.
// Retorna { text, sourcePath } ou lança erro 400.
async function resolveInput(req) {
  if (req.file) {
    return {
      text: await extractText(req.file),
      sourcePath: req.body.source_path || req.file.originalname
    };
  }
  const { text, source_path } = req.body || {};
  if (!text || !String(text).trim()) {
    const err = new Error('Envie um arquivo (campo "file") ou um campo "text" não vazio');
    err.status = 400;
    throw err;
  }
  return { text: String(text), sourcePath: source_path || `texto-avulso-${Date.now()}.txt` };
}

function chunkOptions(body) {
  const s = getSettings();
  return {
    chunkSize: parseInt(body.chunk_size, 10) || s.CHUNK_SIZE,
    overlap: body.chunk_overlap !== undefined && body.chunk_overlap !== ''
      ? parseInt(body.chunk_overlap, 10)
      : s.CHUNK_OVERLAP,
    unit: body.chunk_unit || s.CHUNK_UNIT
  };
}

/**
 * POST /ingest/preview — gera os chunks sem embeddar nem salvar.
 * Mesmo input do POST /ingest. Retorna os chunks pra conferência.
 */
router.post('/preview', upload.single('file'), async (req, res, next) => {
  try {
    const { text, sourcePath } = await resolveInput(req);
    const opts = chunkOptions(req.body);
    const chunks = chunkText(text, opts);
    res.json({
      source_path: sourcePath,
      chunk_options: opts,
      total_chars: text.length,
      count: chunks.length,
      chunks: chunks.map((c, i) => ({ index: i, chars: c.length, text: c }))
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ingest
 * multipart: file + campos abaixo | JSON: { text, source_path, ... }
 * campos: project (obrigatório), chunk_size, chunk_overlap, chunk_unit,
 *         mode (auto|ollama|openai), replace (default true — apaga
 *         versão anterior da mesma fonte antes de inserir)
 */
router.post('/', upload.single('file'), async (req, res, next) => {
  let sourceLabel = '';
  try {
    const project = (req.body?.project || '').trim();
    if (!project) {
      return res.status(400).json({ error: 'Campo "project" é obrigatório' });
    }

    const { text, sourcePath } = await resolveInput(req);
    sourceLabel = sourcePath;
    const opts = chunkOptions(req.body);
    const chunks = chunkText(text, opts);
    if (!chunks.length) {
      return res.status(400).json({ error: 'Nenhum chunk gerado — texto vazio?' });
    }

    const { embeddings, model, fallback } = await embedBatched(chunks, req.body.mode);

    let replaced = 0;
    if (req.body.replace !== 'false' && req.body.replace !== false) {
      replaced = await deleteSource(project, sourcePath);
    }

    const ids = await insertChunks({
      project,
      sourcePath,
      chunks,
      embeddings,
      model,
      metadata: {
        type: path.extname(sourcePath).replace('.', '') || 'text',
        chunk_options: opts,
        ingested_via: req.file ? 'upload' : 'text'
      }
    });

    recordIngest();
    recordEmbeddings(model, chunks.length);
    recordOutcome(true);
    if (fallback) {
      logEvent('WARN', 'embedding', 'Ollama indisponível — ingestão concluída via fallback OpenAI');
    }
    logEvent('INFO', 'ingest', `Ingestão concluída: ${sourcePath} (${ids.length} chunks, ${model}, projeto ${project})`);

    res.status(201).json({
      project,
      source_path: sourcePath,
      chunks: ids.length,
      replaced_chunks: replaced,
      embedding_model: model,
      fallback: Boolean(fallback)
    });
  } catch (err) {
    recordOutcome(false);
    logEvent('ERROR', 'ingest', `Falha na ingestão${sourceLabel ? ` de ${sourceLabel}` : ''}: ${err.message}`);
    next(err);
  }
});

export default router;
