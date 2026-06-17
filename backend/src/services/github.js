import axios from 'axios';
import { getSettings } from './settings.js';

// Cliente da API REST do GitHub. Usa o GITHUB_TOKEN das configurações.
// Sem dependências novas — axios puro.

function client() {
  const { GITHUB_TOKEN } = getSettings();
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN não configurado (Configurações → GitHub)');
  return axios.create({
    baseURL: 'https://api.github.com',
    timeout: 20000,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
}

function wrap(err) {
  const msg = err.response?.data?.message || err.message;
  const status = err.response?.status;
  return new Error(`GitHub${status ? ` (${status})` : ''}: ${msg}`);
}

// usuário autenticado pelo token
export async function whoami() {
  try {
    const { data } = await client().get('/user');
    return { login: data.login, name: data.name, avatar_url: data.avatar_url, html_url: data.html_url };
  } catch (err) { throw wrap(err); }
}

// lista repositórios acessíveis pelo token
export async function listRepos() {
  try {
    const { data } = await client().get('/user/repos', {
      params: { per_page: 100, sort: 'updated', affiliation: 'owner,collaborator,organization_member' }
    });
    return data.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      description: r.description,
      default_branch: r.default_branch,
      language: r.language,
      html_url: r.html_url,
      updated_at: r.updated_at,
      open_issues: r.open_issues_count
    }));
  } catch (err) { throw wrap(err); }
}

export async function listBranches(repo) {
  try {
    const { data } = await client().get(`/repos/${repo}/branches`, { params: { per_page: 100 } });
    return data.map((b) => ({ name: b.name, protected: b.protected }));
  } catch (err) { throw wrap(err); }
}

// conteúdo de um diretório ou arquivo. path vazio = raiz.
export async function getContents(repo, path = '', ref) {
  try {
    const { data } = await client().get(`/repos/${repo}/contents/${encodeURI(path)}`, {
      params: ref ? { ref } : {}
    });
    if (Array.isArray(data)) {
      // diretório
      return {
        type: 'dir',
        path,
        entries: data
          .map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size }))
          .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      };
    }
    // arquivo
    const content = data.content && data.encoding === 'base64'
      ? Buffer.from(data.content, 'base64').toString('utf8')
      : null;
    return { type: 'file', path: data.path, name: data.name, size: data.size, sha: data.sha, content, html_url: data.html_url };
  } catch (err) { throw wrap(err); }
}

// cria ou atualiza um arquivo (= commit). Se já existir, busca o sha antes.
export async function putFile({ repo, path, content, message, branch }) {
  const c = client();
  try {
    let sha;
    try {
      const cur = await c.get(`/repos/${repo}/contents/${encodeURI(path)}`, { params: branch ? { ref: branch } : {} });
      if (!Array.isArray(cur.data)) sha = cur.data.sha; // arquivo existe → update
    } catch (e) {
      if (e.response?.status !== 404) throw e; // 404 = arquivo novo
    }
    const { data } = await c.put(`/repos/${repo}/contents/${encodeURI(path)}`, {
      message: message || `update ${path} via RAG Central`,
      content: Buffer.from(content ?? '', 'utf8').toString('base64'),
      branch: branch || undefined,
      sha
    });
    return {
      committed: true,
      path,
      commit: { sha: data.commit?.sha, html_url: data.commit?.html_url, message: data.commit?.message },
      content_sha: data.content?.sha
    };
  } catch (err) { throw wrap(err); }
}

// árvore recursiva do repo (todos os arquivos). ref = branch ou sha.
export async function getTreeRecursive(repo, ref) {
  try {
    const { data } = await client().get(`/repos/${repo}/git/trees/${encodeURIComponent(ref)}`, {
      params: { recursive: 1 }
    });
    return {
      truncated: Boolean(data.truncated),
      files: (data.tree || []).filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha, size: t.size }))
    };
  } catch (err) { throw wrap(err); }
}

// conteúdo de um blob por sha (texto)
export async function getBlob(repo, sha) {
  try {
    const { data } = await client().get(`/repos/${repo}/git/blobs/${sha}`);
    if (data.encoding === 'base64') return Buffer.from(data.content, 'base64').toString('utf8');
    return data.content || '';
  } catch (err) { throw wrap(err); }
}

// commits recentes
export async function listCommits(repo, ref, limit = 15) {
  try {
    const { data } = await client().get(`/repos/${repo}/commits`, {
      params: { per_page: Math.min(limit, 50), sha: ref || undefined }
    });
    return data.map((c) => ({
      sha: c.sha.slice(0, 7),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author?.name,
      date: c.commit.author?.date,
      html_url: c.html_url
    }));
  } catch (err) { throw wrap(err); }
}
