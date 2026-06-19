// Em dev usa o proxy '/api' (vite.config). Em produção, defina VITE_API_URL
// (no build) com a URL pública do backend, ex: https://rag-api.creativenext.dev
export const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Erro HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  status: () => request('/status'),

  query: (body) => request('/query', { method: 'POST', body: JSON.stringify(body) }),

  chat: (body) => request('/chat', { method: 'POST', body: JSON.stringify(body) }),

  agents: {
    list: () => request('/agents'),
    create: (body) => request('/agents', { method: 'POST', body: JSON.stringify(body) }),
    update: (key, body) => request(`/agents/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (key) => request(`/agents/${encodeURIComponent(key)}`, { method: 'DELETE' })
  },

  conversations: (agent) => request(`/conversations${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`),
  conversation: (id) => request(`/conversations/${id}`),
  deleteConversation: (id) => request(`/conversations/${id}`, { method: 'DELETE' }),
  consolidateConversation: (id) => request(`/conversations/${id}/consolidate`, { method: 'POST' }),

  github: {
    whoami: () => request('/github/whoami'),
    repos: () => request('/github/repos'),
    branches: (repo) => request(`/github/branches?repo=${encodeURIComponent(repo)}`),
    contents: (repo, path = '', ref) =>
      request(`/github/contents?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(path)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`),
    commits: (repo, ref) =>
      request(`/github/commits?repo=${encodeURIComponent(repo)}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`),
    putFile: (body) => request('/github/file', { method: 'PUT', body: JSON.stringify(body) }),
    index: (body) => request('/github/index', { method: 'POST', body: JSON.stringify(body) })
  },

  models: {
    list: (agent) => request(`/models${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`),
    listFor: (base, key) => request('/models', { method: 'POST', body: JSON.stringify({ base, key }) })
  },

  news: {
    status: () => request('/news/status'),
    latest: () => request('/news'),
    brief: (agent) => request(`/news/brief?agent=${encodeURIComponent(agent)}`),
    sync: () => request('/news/sync', { method: 'POST' })
  },

  whatsapp: {
    status: () => request('/whatsapp/status'),
    qr: () => request('/whatsapp/qr'),
    setup: (url) => request('/whatsapp/setup', { method: 'POST', body: JSON.stringify({ url }) }),
    test: (number, text) => request('/whatsapp/test', { method: 'POST', body: JSON.stringify({ number, text }) })
  },

  ingest: (formData) => request('/ingest', { method: 'POST', body: formData }),
  ingestPreview: (formData) => request('/ingest/preview', { method: 'POST', body: formData }),

  sources: () => request('/sources'),
  projects: () => request('/sources/projects'),
  chunks: (project, sourcePath) =>
    request(`/sources/chunks?project=${encodeURIComponent(project)}&source_path=${encodeURIComponent(sourcePath)}`),
  deleteSource: (project, sourcePath) =>
    request('/sources', {
      method: 'DELETE',
      body: JSON.stringify({ project, source_path: sourcePath })
    }),
  reindexSource: (project, sourcePath, mode) =>
    request('/sources/reindex', {
      method: 'POST',
      body: JSON.stringify({ project, source_path: sourcePath, mode })
    }),

  memory: {
    list: ({ kind, project, agent, q, limit, offset } = {}) => {
      const p = new URLSearchParams();
      if (kind) p.set('kind', kind);
      if (project) p.set('project', project);
      if (agent) p.set('agent', agent);
      if (q) p.set('q', q);
      if (limit) p.set('limit', limit);
      if (offset) p.set('offset', offset);
      const qs = p.toString();
      return request(`/memory${qs ? `?${qs}` : ''}`);
    },
    facets: () => request('/memory/facets'),
    stats: () => request('/memory/stats'),
    get: (uid) => request(`/memory/${encodeURIComponent(uid)}`),
    graph: ({ project, limit, neighbors, threshold, hubs, messages } = {}) => {
      const p = new URLSearchParams();
      if (project) p.set('project', project);
      if (limit) p.set('limit', limit);
      if (neighbors) p.set('neighbors', neighbors);
      if (threshold) p.set('threshold', threshold);
      if (hubs === false) p.set('hubs', 'false');
      if (messages === true) p.set('messages', 'true');
      const qs = p.toString();
      return request(`/memory/graph${qs ? `?${qs}` : ''}`);
    },
    add: (body) => request('/memory', { method: 'POST', body: JSON.stringify(body) }),
    update: (uid, text) => request(`/memory/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
    remove: (uid) => request(`/memory/${encodeURIComponent(uid)}`, { method: 'DELETE' })
  },

  cron: {
    list: () => request('/cron'),
    create: (body) => request('/cron', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => request(`/cron/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id) => request(`/cron/${id}`, { method: 'DELETE' }),
    run: (id) => request(`/cron/${id}/run`, { method: 'POST' })
  },

  logs: ({ level, service, limit } = {}) => {
    const params = new URLSearchParams();
    if (level) params.set('level', level);
    if (service) params.set('service', service);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    return request(`/logs${qs ? `?${qs}` : ''}`);
  },

  config: () => request('/config'),
  updateConfig: (patch) => request('/config', { method: 'PUT', body: JSON.stringify(patch) }),
  testConnection: (service) =>
    request('/config/test', { method: 'POST', body: JSON.stringify({ service }) })
};
