import axios from 'axios';
import OpenAI from 'openai';
import { getSettings } from './settings.js';
import { embed } from './embedding.js';
import {
  searchSimilar,
  searchMessages,
  createConversation,
  getRecentMessages,
  insertMessage,
  listAgents
} from './db.js';
import { getToolDefs, executeTool } from './tools.js';

// Persona efetiva de um agente vindo do banco. Se não tiver persona definida,
// monta uma genérica a partir do nome/função.
function personaOf(agent) {
  if (agent?.persona && agent.persona.trim()) return agent.persona;
  const fn = agent?.role ? ` Sua função é: ${agent.role}.` : '';
  return `Você é ${agent?.name || 'um agente'}, parte da equipe.${fn}`;
}

function buildSystemPrompt(persona, contextChunks, memories) {
  let sys =
    `${persona}\n\n` +
    'Você faz parte do "RAG Central", um escritório virtual de agentes de IA. ' +
    'Responda SEMPRE em português do Brasil, de forma conversacional e concisa.';

  if (memories.length) {
    const mem = memories
      .map((m, i) => `[mem ${i + 1}] ${m.content.slice(0, 400)}`)
      .join('\n');
    sys +=
      '\n\nVocê TEM MEMÓRIA de conversas anteriores. Trechos relevantes do que já foi ' +
      'conversado (use para manter continuidade e lembrar do que o usuário já disse):\n' +
      '=== MEMÓRIA ===\n' + mem + '\n=== FIM DA MEMÓRIA ===';
  }

  if (contextChunks.length) {
    const ctx = contextChunks
      .map((c, i) => `[${i + 1}] (${c.source_path})\n${String(c.chunk_text).slice(0, 700)}`)
      .join('\n\n');
    sys +=
      '\n\nUse o CONTEXTO abaixo, extraído da base de conhecimento, quando for relevante ' +
      'para responder. Se a resposta não estiver no contexto, responda com seu próprio ' +
      'conhecimento e deixe claro que não veio da base.\n\n=== CONTEXTO ===\n' +
      ctx +
      '\n=== FIM DO CONTEXTO ===';
  }
  return sys;
}

// Detecta menções @AGENTE no texto (apenas agentes conhecidos).
export function parseMentions(text, knownKeys) {
  const keys = knownKeys instanceof Set ? knownKeys : new Set(knownKeys || []);
  const out = [];
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(text || '')) !== null) {
    const k = m[1].toUpperCase();
    if (keys.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

const embedOne = async (text) => {
  try { const r = await embed([text]); return { embedding: r.embeddings[0], model: r.model }; }
  catch { return { embedding: null, model: null }; }
};

// Gera UMA resposta de um agente dentro de uma conversa já existente.
// O histórico recente (que inclui a última fala do usuário e respostas de
// outros agentes nesta rodada) dá o contexto. Persiste só a resposta.
async function generateReply({ agentKey, persona, conversationId, latestText, qEmbedding, embModel, project, group, images }, onEvent) {
  const s = getSettings();

  let contextChunks = [];
  let memories = [];
  if (qEmbedding) {
    try {
      contextChunks = await searchSimilar({ embedding: qEmbedding, model: embModel, project: project || null, topK: 4, matchModel: true });
    } catch { /* db off */ }
    try {
      memories = await searchMessages({ embedding: qEmbedding, model: embModel, agent: agentKey, excludeConversationId: conversationId, topK: 4, matchModel: true });
    } catch { /* db off */ }
  }

  let recent = [];
  try { recent = await getRecentMessages(conversationId, 12); } catch { /* db off */ }

  let system = buildSystemPrompt(persona, contextChunks, memories);
  if (group?.length > 1) {
    system +=
      `\n\nVocê está numa conversa em GRUPO com: ${group.join(', ')}. ` +
      'As falas dos outros aparecem prefixadas com o nome deles (ex: "MEL: ..."). ' +
      'Responda no seu papel, podendo concordar, complementar ou se dirigir a eles pelo nome. ' +
      'Seja breve — é um bate-papo entre colegas.';
  }

  // mensagens p/ o LLM: rotula falas de assistente com o nome do agente
  const llmMsgs = recent.map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: `${m.agent || 'AGENTE'}: ${m.content}` }
      : { role: 'user', content: m.content }
  );

  if (s.CHAT_PROVIDER === 'openai') {
    system +=
      '\n\nVocê tem FERRAMENTAS (function-calling): pode buscar na base de conhecimento, ' +
      'alimentar a base com notas, e operar repositórios do GitHub (listar, ler, commitar). ' +
      'Use-as quando fizer sentido para realmente executar o que o usuário pede, em vez de só descrever.';
  }
  const messages = [{ role: 'system', content: system }, ...llmMsgs];

  const ctx = { project: project || null, agent: agentKey };
  let answer, model, toolsUsed;
  if (s.CHAT_PROVIDER === 'openai') {
    ({ answer, model, toolsUsed } = onEvent
      ? await runWithToolsStream(s, messages, ctx, onEvent, images)
      : await runWithTools(s, messages, ctx, images));
  } else {
    ({ answer, model } = await callOllama(s, messages));
    toolsUsed = [];
    if (onEvent) onEvent({ type: 'token', agent: agentKey, delta: answer });
  }

  // persiste a resposta (best-effort)
  try {
    const a = await embedOne(answer);
    await insertMessage({
      conversationId, role: 'assistant', agent: agentKey, content: answer,
      embedding: a.embedding, model: a.model || embModel,
      metadata: toolsUsed.length ? { tools: toolsUsed } : {}
    });
  } catch { /* não bloqueia */ }

  const sources = contextChunks.map((c) => ({ source_path: c.source_path, project: c.project, similarity: c.similarity }));
  return { agent: agentKey, answer, sources, memories, model, toolsUsed };
}

// Anexa imagens (data URLs) à última mensagem do usuário, no formato
// multimodal OpenAI (content array com image_url). Retorna os messages.
function withImages(messages, images) {
  if (!images?.length) return messages;
  const out = [...messages];
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') {
      const text = typeof out[i].content === 'string' ? out[i].content : '';
      out[i] = {
        role: 'user',
        content: [
          { type: 'text', text: text || 'Veja a(s) imagem(ns) anexada(s).' },
          ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      };
      break;
    }
  }
  return out;
}

// Loop de function-calling para provedores OpenAI-compatible (MiMo, Groq…).
// O modelo pode chamar ferramentas; executamos e devolvemos o resultado até
// ele produzir a resposta final (máx. 6 rodadas). Suporta imagens (vision).
async function runWithTools(s, baseMessages, ctx, images) {
  const client = new OpenAI({ apiKey: s.CHAT_API_KEY, baseURL: s.CHAT_API_BASE });
  const tools = getToolDefs();
  let messages = withImages([...baseMessages], images);
  let triedNoImg = false;
  const toolsUsed = [];

  for (let i = 0; i < 6; i++) {
    let res;
    try {
      res = await client.chat.completions.create({
        model: s.CHAT_MODEL, messages, temperature: 0.7, tools, tool_choice: 'auto'
      });
    } catch (err) {
      // modelo pode não suportar visão → tenta uma vez sem as imagens
      if (images?.length && !triedNoImg) {
        triedNoImg = true;
        messages = [...baseMessages];
        i--; continue;
      }
      throw new Error(`Falha no provedor de chat (${s.CHAT_API_BASE}): ${err.message}`);
    }
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new Error('Resposta vazia do provedor de chat');

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      return { answer: (msg.content || '').trim(), model: `${s.CHAT_API_BASE}/${s.CHAT_MODEL}`, toolsUsed };
    }

    // registra a fala do assistente (com as chamadas) e executa cada ferramenta
    messages.push(msg);
    for (const tc of calls) {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* args inválidos */ }
      const result = await executeTool(tc.function?.name, args, ctx);
      toolsUsed.push(tc.function?.name);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { answer: 'Executei várias etapas mas atingi o limite de ações. Posso continuar se quiser.', model: `${s.CHAT_API_BASE}/${s.CHAT_MODEL}`, toolsUsed };
}

// Versão STREAMING do loop de tool-use. Emite tokens da resposta final via
// onEvent({type:'token', delta}). Ferramentas são executadas entre as rodadas
// (emite {type:'tool', name}); só a resposta final (sem tool_calls) é streamada.
async function runWithToolsStream(s, baseMessages, ctx, onEvent, images) {
  const client = new OpenAI({ apiKey: s.CHAT_API_KEY, baseURL: s.CHAT_API_BASE });
  const tools = getToolDefs();
  let messages = withImages([...baseMessages], images);
  let triedNoImg = false;
  const toolsUsed = [];
  const model = `${s.CHAT_API_BASE}/${s.CHAT_MODEL}`;

  for (let i = 0; i < 6; i++) {
    let stream;
    try {
      stream = await client.chat.completions.create({
        model: s.CHAT_MODEL, messages, temperature: 0.7, tools, tool_choice: 'auto', stream: true
      });
    } catch (err) {
      if (images?.length && !triedNoImg) { triedNoImg = true; messages = [...baseMessages]; i--; continue; }
      throw new Error(`Falha no provedor de chat (${s.CHAT_API_BASE}): ${err.message}`);
    }

    let content = '';
    const toolCalls = [];
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { content += delta.content; onEvent({ type: 'token', agent: ctx.agent, delta: delta.content }); }
      if (delta.tool_calls) {
        for (const tcd of delta.tool_calls) {
          const idx = tcd.index ?? 0;
          toolCalls[idx] = toolCalls[idx] || { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tcd.id) toolCalls[idx].id = tcd.id;
          if (tcd.function?.name) toolCalls[idx].function.name += tcd.function.name;
          if (tcd.function?.arguments) toolCalls[idx].function.arguments += tcd.function.arguments;
        }
      }
    }

    const calls = toolCalls.filter(Boolean);
    if (calls.length === 0) {
      return { answer: content.trim(), model, toolsUsed };
    }

    // executa ferramentas e continua o loop
    messages.push({ role: 'assistant', content: content || null, tool_calls: calls });
    for (const tc of calls) {
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* args inválidos */ }
      onEvent({ type: 'tool', agent: ctx.agent, name: tc.function?.name });
      const result = await executeTool(tc.function?.name, args, ctx);
      toolsUsed.push(tc.function?.name);
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return { answer: 'Executei várias etapas mas atingi o limite de ações.', model, toolsUsed };
}

/**
 * Orquestra uma rodada de conversa. O agente primário responde; qualquer
 * agente @mencionado na mensagem também entra, vendo o que já foi dito.
 * @returns {Promise<{ conversationId, replies: Array }>}
 */
export async function chatWithAgent({ agent, message, conversationId, history = [], project, fileText, images }, onEvent) {
  const key = String(agent || '').trim().toUpperCase();

  // carrega os agentes do banco (persona/keys dinâmicos)
  let agentMap = new Map();
  try {
    const all = await listAgents();
    agentMap = new Map(all.map((a) => [a.key, a]));
  } catch { /* db off → fallback genérico abaixo */ }

  const primary = agentMap.get(key);
  if (agentMap.size && !primary) throw new Error(`Agente desconhecido: ${agent}`);

  // mensagem efetiva = texto + conteúdo de arquivos anexados (lidos)
  let fullMessage = message;
  if (fileText && fileText.trim()) fullMessage += `\n\n=== ARQUIVOS ANEXADOS ===\n${fileText.slice(0, 8000)}`;
  if (images?.length) fullMessage += `\n\n[${images.length} imagem(ns) anexada(s)]`;

  const { embedding: qEmbedding, model: embModel } = await embedOne(fullMessage);

  // resolve / cria a conversa e registra a fala do usuário UMA vez
  let convId = conversationId || null;
  let dbOk = true;
  try {
    if (!convId) {
      const conv = await createConversation(key, message.slice(0, 60));
      convId = conv.id;
    }
    await insertMessage({ conversationId: convId, role: 'user', agent: null, content: fullMessage, embedding: qEmbedding, model: embModel });
  } catch {
    dbOk = false; // banco offline → modo single-agent sem persistência
  }

  if (onEvent && convId) onEvent({ type: 'meta', conversationId: convId });

  // responders: primário + mencionados (distintos)
  const mentioned = parseMentions(message, new Set(agentMap.keys())).filter((a) => a !== key);
  const responders = [key, ...mentioned];

  const replies = [];
  if (dbOk && convId) {
    // rodada com memória/grupo
    for (const a of responders) {
      if (onEvent) onEvent({ type: 'agent_start', agent: a });
      const reply = await generateReply({
        agentKey: a, persona: personaOf(agentMap.get(a)), conversationId: convId, latestText: message,
        qEmbedding, embModel, project, group: responders, images: a === key ? images : null
      }, onEvent);
      if (onEvent) onEvent({ type: 'agent_done', agent: a, sources: reply.sources, memories: reply.memories, toolsUsed: reply.toolsUsed });
      replies.push(reply);
    }
  } else {
    // fallback sem banco: só o primário
    const s = getSettings();
    const recent = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-8).map((m) => ({ role: m.role, content: m.content }));
    const messages = [
      { role: 'system', content: buildSystemPrompt(personaOf(primary || { name: key }), [], []) },
      ...recent, { role: 'user', content: message }
    ];
    const { answer, model } =
      s.CHAT_PROVIDER === 'openai' ? await callOpenAICompatible(s, messages) : await callOllama(s, messages);
    replies.push({ agent: key, answer, sources: [], memories: [], model });
  }

  return { conversationId: convId, replies };
}

// Endpoint OpenAI-compatible: Groq, OpenRouter, OpenAI, ou o próprio Ollama em /v1.
async function callOpenAICompatible(s, messages) {
  if (!s.CHAT_API_KEY) throw new Error('CHAT_API_KEY não configurada (necessária para o provedor "openai")');
  const client = new OpenAI({ apiKey: s.CHAT_API_KEY, baseURL: s.CHAT_API_BASE });
  let res;
  try {
    res = await client.chat.completions.create({
      model: s.CHAT_MODEL,
      messages,
      temperature: 0.7
    });
  } catch (err) {
    throw new Error(`Falha no provedor de chat (${s.CHAT_API_BASE}): ${err.message}`);
  }
  const answer = res.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('Resposta vazia do provedor de chat');
  return { answer, model: `${s.CHAT_API_BASE}/${s.CHAT_MODEL}` };
}

// Ollama nativo (/api/chat).
async function callOllama(s, messages) {
  let res;
  try {
    res = await axios.post(
      `${s.OLLAMA_URL}/api/chat`,
      { model: s.OLLAMA_CHAT_MODEL, messages, stream: false, options: { temperature: 0.7 } },
      { timeout: 120000 }
    );
  } catch (err) {
    if (err.response?.status === 404) {
      throw new Error(
        `Modelo de chat "${s.OLLAMA_CHAT_MODEL}" não encontrado no Ollama. ` +
          `Rode: ollama pull ${s.OLLAMA_CHAT_MODEL}`
      );
    }
    throw new Error(`Falha ao falar com o Ollama (${s.OLLAMA_URL}): ${err.code || err.message}`);
  }
  const answer = res.data?.message?.content?.trim();
  if (!answer) throw new Error('Resposta vazia do Ollama em /api/chat');
  return { answer, model: `ollama/${s.OLLAMA_CHAT_MODEL}` };
}

// Completação simples (sem ferramentas) usando o provedor configurado.
// Reusado pela consolidação de memória e outros utilitários.
export async function completeChat(messages) {
  const s = getSettings();
  return s.CHAT_PROVIDER === 'openai' ? callOpenAICompatible(s, messages) : callOllama(s, messages);
}

// Loop de tool-use exposto (usado pelo streaming/rotas externas).
export { runWithTools };
