import axios from 'axios';
import OpenAI from 'openai';
import { getSettings } from './settings.js';

// Ollama (nomic-embed-text) gera 768 dims; a coluna do banco é vector(1536).
// Padding com zeros não altera a similaridade de cosseno entre vetores do
// mesmo modelo, e a busca filtra por embedding_model — então é seguro.
function padTo(vec, dims) {
  if (vec.length === dims) return vec;
  if (vec.length > dims) {
    throw new Error(`Embedding com ${vec.length} dims excede EMBEDDING_DIMS=${dims}`);
  }
  return vec.concat(new Array(dims - vec.length).fill(0));
}

export async function checkOllama() {
  const { OLLAMA_URL, OLLAMA_MODEL } = getSettings();
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 2500 });
    const models = (res.data.models || []).map((m) => m.name);
    return {
      online: true,
      url: OLLAMA_URL,
      models,
      model_available: models.some((m) => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL}:`))
    };
  } catch (err) {
    return { online: false, url: OLLAMA_URL, error: err.code || err.message };
  }
}

async function embedOllama(texts) {
  const s = getSettings();
  const res = await axios.post(
    `${s.OLLAMA_URL}/api/embed`,
    { model: s.OLLAMA_MODEL, input: texts },
    { timeout: 120000 }
  );
  const embeddings = res.data?.embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error('Resposta inesperada do Ollama em /api/embed');
  }
  return {
    embeddings: embeddings.map((e) => padTo(e, s.EMBEDDING_DIMS)),
    model: `ollama/${s.OLLAMA_MODEL}`
  };
}

async function embedOpenAI(texts) {
  const s = getSettings();
  if (!s.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  const client = new OpenAI({ apiKey: s.OPENAI_API_KEY });
  const res = await client.embeddings.create({ model: s.OPENAI_EMBED_MODEL, input: texts });
  return {
    embeddings: res.data.map((d) => padTo(d.embedding, s.EMBEDDING_DIMS)),
    model: `openai/${s.OPENAI_EMBED_MODEL}`
  };
}

/**
 * Gera embeddings respeitando o modo configurado.
 * auto   → tenta Ollama; se falhar, cai pra OpenAI
 * ollama → só Ollama
 * openai → só OpenAI
 * Retorna { embeddings, model, fallback? }.
 */
// AggregateError do axios (ECONNREFUSED no Node 20+) tem message vazia
const errText = (err) => err.code || err.message || 'erro desconhecido';

export async function embed(texts, modeOverride) {
  if (!texts.length) return { embeddings: [], model: null };
  const mode = modeOverride || getSettings().EMBEDDING_MODE;

  if (mode === 'ollama') return embedOllama(texts);
  if (mode === 'openai') return embedOpenAI(texts);

  try {
    return await embedOllama(texts);
  } catch (ollamaErr) {
    try {
      const result = await embedOpenAI(texts);
      return { ...result, fallback: true, fallback_reason: `Ollama indisponível: ${errText(ollamaErr)}` };
    } catch (openaiErr) {
      throw new Error(
        `Nenhum provedor de embedding disponível — Ollama: ${errText(ollamaErr)} | OpenAI: ${errText(openaiErr)}`
      );
    }
  }
}

// Embeda em lotes para não estourar payload em ingestões grandes.
export async function embedBatched(texts, modeOverride, batchSize = 32) {
  const all = [];
  let model = null;
  let fallback = false;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // trava o provedor após o primeiro lote pra não misturar modelos
    // dentro do mesmo documento se o Ollama cair no meio
    const effectiveMode = model ? model.split('/')[0] : modeOverride;
    const res = await embed(batch, effectiveMode);
    all.push(...res.embeddings);
    model = res.model;
    fallback = fallback || Boolean(res.fallback);
  }
  return { embeddings: all, model, fallback };
}
