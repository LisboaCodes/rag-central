import { getSettings } from './settings.js';
import { embed, embedBatched } from './embedding.js';
import { searchSimilar, insertChunks } from './db.js';
import { chunkText } from './chunker.js';
import * as gh from './github.js';
import { askPerplexity, perplexityEnabled } from './perplexity.js';

// Ferramentas que os agentes podem invocar (function-calling OpenAI-compatible).
// As de RAG funcionam sempre; as de GitHub só aparecem se houver GITHUB_TOKEN.

const RAG_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_conhecimento',
      description: 'Busca semântica na base de conhecimento (documentos ingeridos). Use para responder com fatos do projeto.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'O que procurar' },
          project: { type: 'string', description: 'Opcional: filtra por projeto' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'alimentar_base',
      description: 'Adiciona um texto/nota à base de conhecimento para lembrar no futuro. Use quando o usuário pedir para memorizar/documentar algo.',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Projeto onde guardar' },
          source: { type: 'string', description: 'Nome/identificador da fonte (ex: "decisao-arquitetura.md")' },
          conteudo: { type: 'string', description: 'O texto a guardar' }
        },
        required: ['project', 'source', 'conteudo']
      }
    }
  }
];

const GITHUB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'listar_repos',
      description: 'Lista os repositórios do GitHub acessíveis.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_arquivos',
      description: 'Lista arquivos/pastas de um diretório de um repositório.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/nome do repo' },
          path: { type: 'string', description: 'Caminho do diretório (vazio = raiz)' }
        },
        required: ['repo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ler_arquivo',
      description: 'Lê o conteúdo de um arquivo de um repositório.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/nome do repo' },
          path: { type: 'string', description: 'Caminho do arquivo' }
        },
        required: ['repo', 'path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'commitar_arquivo',
      description: 'Cria ou atualiza um arquivo num repositório (faz um commit direto). Confirme a intenção antes de usar.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'owner/nome do repo' },
          path: { type: 'string', description: 'Caminho do arquivo' },
          conteudo: { type: 'string', description: 'Conteúdo completo do arquivo' },
          mensagem: { type: 'string', description: 'Mensagem do commit' },
          branch: { type: 'string', description: 'Opcional: branch alvo' }
        },
        required: ['repo', 'path', 'conteudo', 'mensagem']
      }
    }
  }
];

const WEB_TOOL = {
  type: 'function',
  function: {
    name: 'pesquisar_web',
    description: 'Pesquisa na internet em tempo real (via Perplexity) com fontes. Use para novidades, fatos atuais, preços, notícias de IA/APIs.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'O que pesquisar' },
        recencia: { type: 'string', enum: ['day', 'week', 'month'], description: 'Filtra por recência (opcional)' }
      },
      required: ['query']
    }
  }
};

export function getToolDefs() {
  const { GITHUB_TOKEN } = getSettings();
  const defs = [...RAG_TOOLS];
  if (GITHUB_TOKEN) defs.push(...GITHUB_TOOLS);
  if (perplexityEnabled()) defs.push(WEB_TOOL);
  return defs;
}

// Executa uma ferramenta e retorna um objeto serializável (nunca lança:
// erros viram { erro } pra o modelo poder reagir).
export async function executeTool(name, args = {}, ctx = {}) {
  try {
    switch (name) {
      case 'buscar_conhecimento': {
        const { embeddings, model } = await embed([String(args.query || '')]);
        const results = await searchSimilar({
          embedding: embeddings[0], model,
          project: args.project || ctx.project || null, topK: 5, matchModel: true
        });
        return {
          encontrados: results.length,
          trechos: results.map((r) => ({ fonte: r.source_path, similaridade: Number(r.similarity.toFixed(2)), texto: String(r.chunk_text).slice(0, 800) }))
        };
      }
      case 'alimentar_base': {
        const text = String(args.conteudo || '');
        if (!text.trim()) return { erro: 'conteudo vazio' };
        const opts = (() => { const s = getSettings(); return { chunkSize: s.CHUNK_SIZE, overlap: s.CHUNK_OVERLAP, unit: s.CHUNK_UNIT }; })();
        const chunks = chunkText(text, opts);
        const { embeddings, model, fallback } = await embedBatched(chunks);
        await insertChunks({
          project: args.project || ctx.project || 'memoria-agentes',
          sourcePath: args.source || `nota-${Date.now()}.md`,
          chunks, embeddings, model,
          metadata: { type: 'agent_note', by: ctx.agent || null }
        });
        return { ok: true, chunks: chunks.length, modelo: model, fallback: Boolean(fallback) };
      }
      case 'listar_repos': {
        const repos = await gh.listRepos();
        return { repos: repos.map((r) => ({ nome: r.full_name, privado: r.private, lang: r.language, branch: r.default_branch, desc: r.description })) };
      }
      case 'listar_arquivos': {
        const data = await gh.getContents(args.repo, args.path || '');
        if (data.type === 'file') return { tipo: 'arquivo', path: data.path };
        return { tipo: 'dir', path: data.path, itens: data.entries.map((e) => ({ nome: e.name, tipo: e.type, path: e.path })) };
      }
      case 'ler_arquivo': {
        const data = await gh.getContents(args.repo, args.path);
        if (data.type !== 'file') return { erro: 'caminho não é um arquivo' };
        return { path: data.path, tamanho: data.size, conteudo: String(data.content || '').slice(0, 8000) };
      }
      case 'commitar_arquivo': {
        const res = await gh.putFile({ repo: args.repo, path: args.path, content: args.conteudo, message: args.mensagem, branch: args.branch });
        return { ok: true, commit: res.commit?.sha?.slice(0, 7), url: res.commit?.html_url, path: res.path };
      }
      case 'pesquisar_web': {
        const r = await askPerplexity(String(args.query || ''), { recency: args.recencia });
        return { resposta: r.text.slice(0, 4000), fontes: r.citations.slice(0, 8) };
      }
      default:
        return { erro: `ferramenta desconhecida: ${name}` };
    }
  } catch (err) {
    return { erro: err.message };
  }
}
