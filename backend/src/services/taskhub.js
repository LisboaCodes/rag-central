import axios from 'axios';
import { getSettings } from './settings.js';

// Cliente do servidor MCP do TaskHub (app de tarefas/hábitos/etc que roda
// como serviço próprio, ver INTEGRACAO-CERBERUS.md). Falamos JSON-RPC 2.0 no
// endpoint /api/mcp autenticando com Bearer MCP_SECRET. Assim os agentes do
// CERBERUS operam o TaskHub (criar tarefa, listar hábitos, resumo do dia…)
// sem reescrever nada — o TaskHub já expõe ~20 ferramentas.

const PROTOCOL_VERSION = '2025-06-18';

export function taskhubEnabled() {
  const s = getSettings();
  return Boolean(s.TASKHUB_ENABLED && s.TASKHUB_MCP_URL && s.TASKHUB_MCP_SECRET);
}

// URL do endpoint MCP (default: <base>/api/mcp). Aceita já vir completa.
function mcpUrl() {
  const raw = String(getSettings().TASKHUB_MCP_URL || '').replace(/\/+$/, '');
  if (!raw) return '';
  return /\/api\/mcp$/.test(raw) ? raw : `${raw}/api/mcp`;
}

let rpcId = 0;
async function rpc(method, params) {
  const s = getSettings();
  const url = mcpUrl();
  if (!url) throw new Error('TASKHUB_MCP_URL não configurada');
  const { data } = await axios.post(
    url,
    { jsonrpc: '2.0', id: ++rpcId, method, ...(params ? { params } : {}) },
    {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${s.TASKHUB_MCP_SECRET}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': PROTOCOL_VERSION
      }
    }
  );
  if (data?.error) throw new Error(data.error.message || `MCP erro ${data.error.code}`);
  return data?.result;
}

// tools/list é estável em runtime → cacheia por alguns minutos.
let toolsCache = null;
let toolsCacheAt = 0;
const TOOLS_TTL = 5 * 60 * 1000;

/** Lista as ferramentas do TaskHub no formato MCP ({name, description, inputSchema}). */
export async function listMcpTools({ force = false } = {}) {
  if (!force && toolsCache && Date.now() - toolsCacheAt < TOOLS_TTL) return toolsCache;
  const result = await rpc('tools/list');
  toolsCache = Array.isArray(result?.tools) ? result.tools : [];
  toolsCacheAt = Date.now();
  return toolsCache;
}

/** Chama uma ferramenta do TaskHub e devolve o payload já parseado. */
export async function callMcpTool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args || {} });
  const text = (result?.content || [])
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
  if (result?.isError) {
    return { erro: text || 'erro na ferramenta do TaskHub' };
  }
  // as ferramentas do TaskHub devolvem JSON serializado como texto
  if (text) {
    try { return JSON.parse(text); } catch { return { texto: text }; }
  }
  return { ok: true };
}

/** Testa a conexão (initialize) — usado pelo /taskhub/status e Configurações. */
export async function pingTaskhub() {
  const result = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'cerberus-rag', version: '1.0.0' }
  });
  return { ok: true, server: result?.serverInfo || null, instructions: result?.instructions || '' };
}

export function invalidateToolsCache() {
  toolsCache = null;
  toolsCacheAt = 0;
}
