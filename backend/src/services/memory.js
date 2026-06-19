import { completeChat } from './chat.js';
import {
  getConversation, insertChunks, deleteSource,
  getConsolidationState, markConsolidated,
  updateMemoryText, deleteMemoryRow
} from './db.js';
import { embed, embedBatched } from './embedding.js';
import { chunkText } from './chunker.js';
import { getSettings } from './settings.js';
import { logEvent } from './activity.js';

// a cada quantas mensagens novas a conversa é re-consolidada automaticamente
const AUTO_EVERY = 10;

// Consolida uma conversa em FATOS duráveis e os guarda na base vetorial
// (projeto "memoria-consolidada"), pra memória de longo prazo continuar
// afiada sem precisar reprocessar a conversa inteira toda vez.
export async function consolidateConversation(conversationId) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error('conversa não encontrada');
  if (!conv.messages.length) throw new Error('conversa sem mensagens');

  const transcript = conv.messages
    .map((m) => `${m.role === 'user' ? 'Usuário' : (m.agent || 'Agente')}: ${m.content}`)
    .join('\n')
    .slice(0, 12000);

  const messages = [
    {
      role: 'system',
      content:
        'Você resume conversas em FATOS duráveis para memória de longo prazo de um time de agentes. ' +
        'Extraia somente o que vale lembrar no futuro: decisões, preferências do usuário, dados concretos, ' +
        'combinados e pendências. Ignore saudações e conversa fiada. Responda em português, em tópicos curtos e objetivos.'
    },
    { role: 'user', content: `Resuma a conversa abaixo em fatos para memória:\n\n${transcript}` }
  ];

  const { answer } = await completeChat(messages);

  // uma conversa = um único resumo: apaga a versão anterior antes de regravar
  // (evita acumular fatos duplicados a cada re-consolidação).
  const sourcePath = `conversa-${conversationId}.md`;
  await deleteSource('memoria-consolidada', sourcePath).catch(() => {});

  const header = `# Memória consolidada — conversa #${conversationId} (${conv.agent})\n\n`;
  const chunks = chunkText(header + answer, { chunkSize: 512, overlap: 64, unit: 'tokens' });
  const { embeddings, model } = await embedBatched(chunks);
  await insertChunks({
    project: 'memoria-consolidada',
    sourcePath,
    chunks, embeddings, model,
    metadata: { type: 'memory_summary', conversation_id: conversationId, agent: conv.agent }
  });

  return { summary: answer, chunks: chunks.length };
}

// Auto-consolidação: roda em background ao fim de uma rodada de chat. Só
// dispara quando há AUTO_EVERY mensagens novas desde a última consolidação,
// pra não chamar o LLM a cada mensagem. Best-effort (nunca lança pro chat).
export async function maybeAutoConsolidate(conversationId) {
  try {
    const { consolidated, total } = await getConsolidationState(conversationId);
    if (total - consolidated < AUTO_EVERY) return false;
    await consolidateConversation(conversationId);
    await markConsolidated(conversationId, total);
    logEvent('INFO', 'memory', `conversa ${conversationId} auto-consolidada (${total} mensagens)`);
    return true;
  } catch (err) {
    logEvent('WARN', 'memory', `auto-consolidação falhou (conv ${conversationId}): ${err.message}`);
    return false;
  }
}

// uid: 'doc:123' → { store: 'documents', id: 123 } | 'msg:45' → messages
function parseUid(uid) {
  const [tag, rawId] = String(uid || '').split(':');
  const id = parseInt(rawId, 10);
  if (!id || (tag !== 'doc' && tag !== 'msg')) throw new Error('uid inválido');
  return { store: tag === 'doc' ? 'documents' : 'messages', id };
}

// Edita o texto de um item de memória e re-embeda pra manter a busca coerente.
export async function editMemoryItem(uid, text) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('texto vazio');
  const { store, id } = parseUid(uid);
  let embedding = null, model = null;
  try { const r = await embed([clean]); embedding = r.embeddings[0]; model = r.model; }
  catch { /* sem embedding novo → mantém o antigo, só troca o texto */ }
  const n = await updateMemoryText({ store, id, text: clean, embedding, model });
  if (!n) throw new Error('item não encontrado');
  return { uid, updated: n, reembedded: Boolean(embedding) };
}

export async function deleteMemoryItem(uid) {
  const { store, id } = parseUid(uid);
  const n = await deleteMemoryRow({ store, id });
  if (!n) throw new Error('item não encontrado');
  return { uid, deleted: n };
}

// Adiciona manualmente um fato/nota à memória (você no controle).
export async function addMemoryFact({ project, source, text, agent }) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('texto vazio');
  const s = getSettings();
  const chunks = chunkText(clean, { chunkSize: s.CHUNK_SIZE, overlap: s.CHUNK_OVERLAP, unit: s.CHUNK_UNIT });
  const { embeddings, model, fallback } = await embedBatched(chunks);
  const ids = await insertChunks({
    project: project || 'memoria-agentes',
    sourcePath: source || `fato-${Date.now()}.md`,
    chunks, embeddings, model,
    metadata: { type: 'manual_fact', by: agent || 'você' }
  });
  return { chunks: chunks.length, ids, model, fallback: Boolean(fallback) };
}
