import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getSettings } from './settings.js';
import { logEvent } from './activity.js';
import * as gh from './github.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Runner de projetos: cada projeto é uma pasta dentro de PROJECTS_DIR.
// Roda comandos (scripts/serviços) com console ao vivo, edita arquivos pelo
// painel e importa do GitHub/upload. ATENÇÃO: executa código no host — fica
// atrás do login. Pensado para homelab/local.

const MAX_LOG_LINES = 1500;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.cerberus']);
const TEXT_EXT = new Set(['.py', '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml',
  '.toml', '.ini', '.cfg', '.env', '.sh', '.sql', '.xml', '.csv', '.gitignore', '.dockerfile']);

// name -> { proc, status, exitCode, startedAt, command, logs: [], listeners:Set }
const runtimes = new Map();

// ---- raiz / caminhos seguros ----------------------------------------------

export function projectsRoot() {
  const cfg = getSettings().PROJECTS_DIR;
  const root = cfg ? path.resolve(cfg) : path.resolve(__dirname, '../../projects');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function sanitizeName(name) {
  const safe = String(name || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe === '.' || safe === '..') throw httpErr(400, 'nome de projeto inválido');
  return safe;
}

function projectDir(name) {
  return path.join(projectsRoot(), sanitizeName(name));
}

// resolve um caminho relativo garantindo que fica DENTRO do projeto (anti ../)
function resolveSafe(name, rel) {
  const base = projectDir(name);
  const p = path.resolve(base, rel || '.');
  if (p !== base && !p.startsWith(base + path.sep)) throw httpErr(400, 'caminho fora do projeto');
  return p;
}

function exists(p) { return fs.existsSync(p); }

// ---- CRUD de projetos -----------------------------------------------------

export async function listProjects() {
  const root = projectsRoot();
  const entries = await fsp.readdir(root, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    out.push({ name: e.name, ...statusOf(e.name), config: await readConfig(e.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createProject(name) {
  const dir = projectDir(name);
  if (exists(dir)) throw httpErr(409, 'já existe um projeto com esse nome');
  await fsp.mkdir(dir, { recursive: true });
  await writeConfig(name, { install: '', start: '', type: 'oneshot' });
  logEvent('INFO', 'projects', `projeto criado: ${sanitizeName(name)}`);
  return { name: sanitizeName(name) };
}

export async function deleteProject(name) {
  stopProject(name);
  await fsp.rm(projectDir(name), { recursive: true, force: true });
  runtimes.delete(sanitizeName(name));
  return { deleted: true };
}

// ---- config do projeto (.cerberus.json) -----------------------------------

function configPath(name) { return path.join(projectDir(name), '.cerberus.json'); }

export async function readConfig(name) {
  try { return JSON.parse(await fsp.readFile(configPath(name), 'utf8')); }
  catch { return { install: '', start: '', type: 'oneshot' }; }
}

export async function writeConfig(name, cfg) {
  const cur = await readConfig(name);
  const next = {
    install: cfg.install ?? cur.install ?? '',
    start: cfg.start ?? cur.start ?? '',
    type: cfg.type ?? cur.type ?? 'oneshot'
  };
  await fsp.writeFile(configPath(name), JSON.stringify(next, null, 2));
  return next;
}

// ---- árvore de arquivos / editor ------------------------------------------

export async function getTree(name) {
  const base = projectDir(name);
  if (!exists(base)) throw httpErr(404, 'projeto não encontrado');
  async function walk(dir, rel) {
    const out = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      if (e.name === '.cerberus.json') continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) { out.push({ name: e.name, path: childRel, type: 'dir', skipped: true, children: [] }); continue; }
        out.push({ name: e.name, path: childRel, type: 'dir', children: await walk(path.join(dir, e.name), childRel) });
      } else {
        out.push({ name: e.name, path: childRel, type: 'file' });
      }
    }
    return out;
  }
  return walk(base, '');
}

export async function readProjectFile(name, rel) {
  const p = resolveSafe(name, rel);
  const st = await fsp.stat(p);
  if (st.isDirectory()) throw httpErr(400, 'é um diretório');
  if (st.size > 512 * 1024) throw httpErr(413, 'arquivo grande demais para editar (>512KB)');
  const ext = path.extname(rel).toLowerCase();
  if (ext && !TEXT_EXT.has(ext) && !path.basename(rel).startsWith('.')) {
    // tenta mesmo assim, mas avisa se vier binário
  }
  const content = await fsp.readFile(p, 'utf8');
  return { path: rel, content, size: st.size };
}

export async function writeProjectFile(name, rel, content) {
  const p = resolveSafe(name, rel);
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content ?? '', 'utf8');
  return { path: rel, size: Buffer.byteLength(content ?? '') };
}

export async function createEntry(name, rel, kind) {
  const p = resolveSafe(name, rel);
  if (exists(p)) throw httpErr(409, 'já existe');
  if (kind === 'dir') await fsp.mkdir(p, { recursive: true });
  else { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, ''); }
  return { path: rel, type: kind };
}

export async function deleteEntry(name, rel) {
  const p = resolveSafe(name, rel);
  if (p === projectDir(name)) throw httpErr(400, 'não dá para apagar a raiz');
  await fsp.rm(p, { recursive: true, force: true });
  return { deleted: rel };
}

export async function saveUpload(name, rel, buffer) {
  const target = resolveSafe(name, rel);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, buffer);
  return { path: rel, size: buffer.length };
}

// ---- importar do GitHub ----------------------------------------------------

export async function importFromGithub(name, repo, ref) {
  const { files, truncated } = await gh.getTreeRecursive(repo, ref || 'HEAD');
  const wanted = (files || []).filter((f) => (f.size ?? 0) < 512 * 1024
    && !f.path.split('/').some((seg) => SKIP_DIRS.has(seg)));
  let written = 0;
  for (const f of wanted.slice(0, 400)) {
    try {
      const blob = await gh.getBlob(repo, f.sha);
      await writeProjectFile(name, f.path, blob);
      written += 1;
    } catch { /* pula arquivo problemático */ }
  }
  logEvent('INFO', 'projects', `importado ${written} arquivo(s) de ${repo} para ${sanitizeName(name)}`);
  return { imported: written, total: wanted.length, truncated };
}

// ---- processos / console ao vivo ------------------------------------------

function rt(name) {
  const key = sanitizeName(name);
  if (!runtimes.has(key)) runtimes.set(key, { proc: null, status: 'idle', exitCode: null, startedAt: null, command: null, logs: [], listeners: new Set() });
  return runtimes.get(key);
}

function pushLog(r, stream, text) {
  const ts = Date.now();
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') continue;
    const entry = { ts, stream, line };
    r.logs.push(entry);
    if (r.logs.length > MAX_LOG_LINES) r.logs.shift();
    for (const res of r.listeners) { try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { /* listener morto */ } }
  }
}

function broadcastStatus(r) {
  const s = { ts: Date.now(), stream: 'status', status: r.status, exitCode: r.exitCode };
  for (const res of r.listeners) { try { res.write(`event: status\ndata: ${JSON.stringify(s)}\n\n`); } catch { /* */ } }
}

// roda um comando arbitrário no diretório do projeto
export function runCommand(name, command, { label } = {}) {
  const key = sanitizeName(name);
  const r = rt(key);
  if (r.proc) throw httpErr(409, 'já há um processo rodando neste projeto');
  if (!command || !String(command).trim()) throw httpErr(400, 'comando vazio');
  const cwd = projectDir(key);
  if (!exists(cwd)) throw httpErr(404, 'projeto não encontrado');

  r.command = command;
  r.status = 'running';
  r.exitCode = null;
  r.startedAt = Date.now();
  pushLog(r, 'system', `$ ${label ? `[${label}] ` : ''}${command}`);
  broadcastStatus(r);

  const proc = spawn(command, { cwd, shell: true, env: { ...process.env }, windowsHide: true });
  r.proc = proc;
  proc.stdout.on('data', (d) => pushLog(r, 'stdout', d.toString()));
  proc.stderr.on('data', (d) => pushLog(r, 'stderr', d.toString()));
  proc.on('error', (err) => pushLog(r, 'stderr', `[erro ao iniciar] ${err.message}`));
  proc.on('close', (code) => {
    r.proc = null;
    r.status = 'exited';
    r.exitCode = code;
    pushLog(r, 'system', `processo terminou (código ${code})`);
    broadcastStatus(r);
    logEvent(code === 0 ? 'INFO' : 'WARN', 'projects', `"${key}" terminou (código ${code})`);
  });
  logEvent('INFO', 'projects', `"${key}" iniciou: ${command}`);
  return { ok: true, pid: proc.pid };
}

export async function startProject(name) {
  const cfg = await readConfig(name);
  if (!cfg.start?.trim()) throw httpErr(400, 'defina o comando de execução (start) nas configurações do projeto');
  return runCommand(name, cfg.start, { label: 'start' });
}

export async function installProject(name) {
  const cfg = await readConfig(name);
  if (!cfg.install?.trim()) throw httpErr(400, 'defina o comando de instalação (install) nas configurações do projeto');
  return runCommand(name, cfg.install, { label: 'install' });
}

export function stopProject(name) {
  const r = rt(name);
  if (!r.proc) return { ok: true, alreadyStopped: true };
  pushLog(r, 'system', 'parando processo…');
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(r.proc.pid), '/T', '/F']);
    else r.proc.kill('SIGTERM');
  } catch { /* já morreu */ }
  r.status = 'stopping';
  broadcastStatus(r);
  return { ok: true };
}

function statusOf(name) {
  const r = runtimes.get(sanitizeName(name));
  if (!r) return { status: 'idle', running: false, exitCode: null, startedAt: null };
  return { status: r.status, running: Boolean(r.proc), exitCode: r.exitCode, startedAt: r.startedAt, command: r.command };
}

export function getStatus(name) { return statusOf(name); }
export function getLogs(name) { return rt(name).logs; }

// inscreve um response SSE para receber o console ao vivo (manda o buffer atual)
export function subscribeLogs(name, res) {
  const r = rt(name);
  res.write(`event: status\ndata: ${JSON.stringify({ status: r.status, exitCode: r.exitCode })}\n\n`);
  for (const entry of r.logs) res.write(`data: ${JSON.stringify(entry)}\n\n`);
  r.listeners.add(res);
  return () => r.listeners.delete(res);
}

export function clearLogs(name) { rt(name).logs = []; return { ok: true }; }

// ---- util -----------------------------------------------------------------

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
