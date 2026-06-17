import { Router } from 'express';
import { whoami, listRepos, listBranches, getContents, putFile, listCommits, getTreeRecursive, getBlob } from '../services/github.js';
import { chunkText } from '../services/chunker.js';
import { embedBatched } from '../services/embedding.js';
import { insertChunks } from '../services/db.js';
import { logEvent, recordIngest } from '../services/activity.js';

const router = Router();

// extensões de texto que vale indexar
const TEXT_EXT = new Set([
  'md', 'txt', 'js', 'ts', 'jsx', 'tsx', 'py', 'php', 'rb', 'go', 'rs', 'java', 'cs',
  'json', 'yml', 'yaml', 'toml', 'ini', 'env', 'sql', 'sh', 'html', 'css', 'scss', 'vue', 'svelte'
]);
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|build|vendor|\.next|coverage|__pycache__)\//;
const SKIP_FILE = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const ext = (p) => p.split('.').pop().toLowerCase();

// POST /github/index — indexa todos os arquivos de texto de um repo na base
// body: { repo, branch?, project?, maxFiles? }
router.post('/index', async (req, res, next) => {
  const { repo, branch = 'HEAD', project, maxFiles = 200 } = req.body || {};
  try {
    if (!repo) return res.status(400).json({ error: 'campo "repo" é obrigatório' });
    const proj = project || repo.split('/').pop();

    const { files, truncated } = await getTreeRecursive(repo, branch);
    const eligible = files
      .filter((f) => TEXT_EXT.has(ext(f.path)) && !SKIP_DIR.test('/' + f.path) && !SKIP_FILE.test(f.path) && (f.size || 0) < 100000)
      .slice(0, maxFiles);

    let totalChunks = 0, indexed = 0, failed = 0;
    for (const f of eligible) {
      try {
        const content = await getBlob(repo, f.sha);
        if (!content.trim()) continue;
        const chunks = chunkText(content, { chunkSize: 512, overlap: 64, unit: 'tokens' });
        if (!chunks.length) continue;
        const { embeddings, model } = await embedBatched(chunks);
        await insertChunks({
          project: proj, sourcePath: f.path, chunks, embeddings, model,
          metadata: { type: 'github', repo, path: f.path }
        });
        totalChunks += chunks.length; indexed++;
      } catch { failed++; }
    }
    recordIngest();
    logEvent('INFO', 'github', `repo ${repo} indexado: ${indexed} arquivos, ${totalChunks} chunks (projeto ${proj})`);
    res.json({ repo, project: proj, candidates: eligible.length, indexed, failed, chunks: totalChunks, truncated });
  } catch (err) {
    logEvent('ERROR', 'github', `falha ao indexar ${repo}: ${err.message}`);
    err.status = 400; next(err);
  }
});

// GET /github/whoami — valida o token e retorna o usuário
router.get('/whoami', async (req, res, next) => {
  try { res.json(await whoami()); } catch (err) { err.status = 400; next(err); }
});

// GET /github/repos — lista repositórios
router.get('/repos', async (req, res, next) => {
  try { res.json({ repos: await listRepos() }); } catch (err) { err.status = 400; next(err); }
});

// GET /github/branches?repo=owner/name
router.get('/branches', async (req, res, next) => {
  try {
    if (!req.query.repo) return res.status(400).json({ error: 'param "repo" obrigatório' });
    res.json({ branches: await listBranches(req.query.repo) });
  } catch (err) { err.status = 400; next(err); }
});

// GET /github/contents?repo=owner/name&path=src&ref=main
router.get('/contents', async (req, res, next) => {
  try {
    if (!req.query.repo) return res.status(400).json({ error: 'param "repo" obrigatório' });
    res.json(await getContents(req.query.repo, req.query.path || '', req.query.ref));
  } catch (err) { err.status = 400; next(err); }
});

// GET /github/commits?repo=owner/name&ref=main
router.get('/commits', async (req, res, next) => {
  try {
    if (!req.query.repo) return res.status(400).json({ error: 'param "repo" obrigatório' });
    res.json({ commits: await listCommits(req.query.repo, req.query.ref) });
  } catch (err) { err.status = 400; next(err); }
});

// PUT /github/file — cria/atualiza arquivo (= commit)
// body: { repo, path, content, message, branch }
router.put('/file', async (req, res, next) => {
  const { repo, path, content, message, branch } = req.body || {};
  try {
    if (!repo || !path) return res.status(400).json({ error: 'campos "repo" e "path" são obrigatórios' });
    const result = await putFile({ repo, path, content, message, branch });
    logEvent('INFO', 'github', `commit em ${repo}: ${path} (${result.commit?.sha?.slice(0, 7) || '?'})`);
    res.json(result);
  } catch (err) {
    logEvent('ERROR', 'github', `falha de commit em ${repo}/${path}: ${err.message}`);
    err.status = 400; next(err);
  }
});

export default router;
