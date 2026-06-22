import crypto from 'crypto';
import { getSettings } from './settings.js';
import {
  getVaultMeta, setVaultMeta, setVaultAgentMaster, findVaultAccountByEmail,
  listVaultAccounts, getVaultAccount, createVaultAccount, updateVaultAccount, deleteVaultAccount,
  listVaultServices, getVaultService, createVaultService, updateVaultService, deleteVaultService
} from './db.js';

// Cofre cifrado com senha-mestra.
//   chave = scrypt(senhaMestra, salt)  -> 32 bytes
//   cada segredo: AES-256-GCM (iv 12B + tag 16B + cipher), base64
// A chave derivada NUNCA é persistida. Após o unlock ela fica em memória,
// presa à sessão (fingerprint do token de login), com validade curta.

const VERIFIER_PLAINTEXT = 'CERBERUS-VAULT-OK';
const UNLOCK_TTL_MS = 30 * 60 * 1000;       // 30 min de cofre aberto por sessão

// fingerprint do token -> { key: Buffer, expiresAt }
const unlocked = new Map();

// ---- cripto ---------------------------------------------------------------

function deriveKey(password, saltHex) {
  return crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
}

function encrypt(key, plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(key, blob) {
  if (!blob) return '';
  const raw = Buffer.from(blob, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ---- estado / senha-mestra ------------------------------------------------

export async function vaultStatus(fp) {
  const meta = await getVaultMeta();
  return { initialized: Boolean(meta), unlocked: isUnlocked(fp) };
}

export async function setupMaster(password) {
  if (await getVaultMeta()) throw httpErr(409, 'Cofre já foi inicializado');
  if (!password || String(password).length < 8) throw httpErr(400, 'A senha-mestra precisa ter ao menos 8 caracteres');
  const salt = crypto.randomBytes(16).toString('hex');
  const key = deriveKey(password, salt);
  const verifier = encrypt(key, VERIFIER_PLAINTEXT);
  await setVaultMeta(salt, verifier);
  return true;
}

export async function unlock(fp, password) {
  const meta = await getVaultMeta();
  if (!meta) throw httpErr(400, 'Cofre ainda não inicializado');
  const key = deriveKey(password, meta.salt);
  let ok = false;
  try { ok = decrypt(key, meta.verifier) === VERIFIER_PLAINTEXT; } catch { ok = false; }
  if (!ok) throw httpErr(401, 'Senha-mestra incorreta');
  unlocked.set(fp, { key, expiresAt: Date.now() + UNLOCK_TTL_MS });
  return true;
}

export function lock(fp) {
  unlocked.delete(fp);
}

function isUnlocked(fp) {
  const u = unlocked.get(fp);
  if (!u) return false;
  if (u.expiresAt < Date.now()) { unlocked.delete(fp); return false; }
  return true;
}

function keyFor(fp) {
  const u = unlocked.get(fp);
  if (!u || u.expiresAt < Date.now()) { unlocked.delete(fp); throw httpErr(423, 'Cofre bloqueado — informe a senha-mestra'); }
  u.expiresAt = Date.now() + UNLOCK_TTL_MS;  // renova o relógio a cada uso
  return u.key;
}

// ---- contas de e-mail -----------------------------------------------------

export async function getAccounts(fp, { reveal = false } = {}) {
  const key = keyFor(fp);
  const rows = await listVaultAccounts();
  return rows.map((r) => shapeAccount(r, key, reveal));
}

export async function addAccount(fp, body) {
  const key = keyFor(fp);
  if (!body?.email) throw httpErr(400, 'E-mail da conta é obrigatório');
  const row = await createVaultAccount({
    label: body.label, email: body.email, provider: body.provider,
    secret_enc: encrypt(key, body.password), notes_enc: encrypt(key, body.notes)
  });
  return shapeAccount(row, key, true);
}

export async function editAccount(fp, id, body) {
  const key = keyFor(fp);
  const patch = {};
  if (body.label !== undefined) patch.label = body.label;
  if (body.email !== undefined) patch.email = body.email;
  if (body.provider !== undefined) patch.provider = body.provider;
  if (body.password !== undefined) patch.secret_enc = encrypt(key, body.password);
  if (body.notes !== undefined) patch.notes_enc = encrypt(key, body.notes);
  const row = await updateVaultAccount(id, patch);
  if (!row) throw httpErr(404, 'Conta não encontrada');
  return shapeAccount(row, key, true);
}

export async function removeAccount(fp, id) {
  keyFor(fp);
  return deleteVaultAccount(id);
}

// ---- serviços -------------------------------------------------------------

export async function getServices(fp, { reveal = false } = {}) {
  const key = keyFor(fp);
  const rows = await listVaultServices();
  return rows.map((r) => shapeService(r, key, reveal));
}

export async function addService(fp, body) {
  const key = keyFor(fp);
  if (!body?.name) throw httpErr(400, 'Nome do serviço é obrigatório');
  const row = await createVaultService({
    account_id: body.account_id || null,
    name: body.name, login: body.login || null, url: body.url || null, category: body.category || null,
    cost: numOrNull(body.cost), currency: body.currency || 'BRL', billing_cycle: body.billing_cycle || null,
    started_on: dateOrNull(body.started_on), expires_on: dateOrNull(body.expires_on),
    secret_enc: encrypt(key, body.password), notes_enc: encrypt(key, body.notes)
  });
  return shapeService(row, key, true);
}

export async function editService(fp, id, body) {
  const key = keyFor(fp);
  const patch = {};
  for (const f of ['account_id', 'name', 'login', 'url', 'category', 'currency', 'billing_cycle']) {
    if (body[f] !== undefined) patch[f] = body[f] || null;
  }
  if (body.cost !== undefined) patch.cost = numOrNull(body.cost);
  if (body.started_on !== undefined) patch.started_on = dateOrNull(body.started_on);
  if (body.expires_on !== undefined) patch.expires_on = dateOrNull(body.expires_on);
  if (body.password !== undefined) patch.secret_enc = encrypt(key, body.password);
  if (body.notes !== undefined) patch.notes_enc = encrypt(key, body.notes);
  const row = await updateVaultService(id, patch);
  if (!row) throw httpErr(404, 'Serviço não encontrado');
  return shapeService(row, key, true);
}

export async function removeService(fp, id) {
  keyFor(fp);
  return deleteVaultService(id);
}

// ---- shape (decifra segredos só quando reveal=true) -----------------------

function shapeAccount(r, key, reveal) {
  return {
    id: r.id, label: r.label, email: r.email, provider: r.provider,
    hasPassword: Boolean(r.secret_enc),
    password: reveal ? safeDecrypt(key, r.secret_enc) : undefined,
    notes: reveal ? safeDecrypt(key, r.notes_enc) : undefined,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

function shapeService(r, key, reveal) {
  return {
    id: r.id, account_id: r.account_id, name: r.name, login: r.login, url: r.url,
    category: r.category, cost: r.cost === null ? null : Number(r.cost), currency: r.currency,
    billing_cycle: r.billing_cycle, started_on: r.started_on, expires_on: r.expires_on,
    hasPassword: Boolean(r.secret_enc),
    password: reveal ? safeDecrypt(key, r.secret_enc) : undefined,
    notes: reveal ? safeDecrypt(key, r.notes_enc) : undefined,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

function safeDecrypt(key, blob) {
  try { return decrypt(key, blob); } catch { return ''; }
}

// ---- acesso da IA (agente opera o cofre com a chave guardada) -------------
// A senha-mestra fica cifrada (agent_master_enc) com uma chave derivada do
// VAULT_AGENT_SECRET (.env). Assim o banco sozinho não abre o cofre.

export function agentSecretConfigured() {
  return Boolean(getSettings().VAULT_AGENT_SECRET);
}

export async function agentAccessEnabled() {
  const meta = await getVaultMeta();
  return Boolean(meta?.agent_master_enc);
}

export function agentAllowed(agentKey) {
  const keys = String(getSettings().VAULT_AGENT_KEYS || '')
    .split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
  return Boolean(agentKey) && keys.includes(String(agentKey).toUpperCase());
}

function wrapKey(meta) {
  const secret = getSettings().VAULT_AGENT_SECRET;
  if (!secret) throw httpErr(400, 'VAULT_AGENT_SECRET não configurado (.env do backend)');
  return deriveKey(secret, meta.salt);
}

// libera (ou revoga) o acesso da IA. Exige a senha-mestra correta.
export async function setAgentAccess(masterPassword, enable) {
  const meta = await getVaultMeta();
  if (!meta) throw httpErr(400, 'Cofre ainda não inicializado');
  if (!enable) { await setVaultAgentMaster(null); return false; }
  const key = deriveKey(masterPassword, meta.salt);
  let ok = false;
  try { ok = decrypt(key, meta.verifier) === VERIFIER_PLAINTEXT; } catch { ok = false; }
  if (!ok) throw httpErr(401, 'Senha-mestra incorreta');
  await setVaultAgentMaster(encrypt(wrapKey(meta), masterPassword));
  return true;
}

// deriva a chave do cofre a partir da senha-mestra guardada (uso interno do agente)
async function agentKey() {
  const meta = await getVaultMeta();
  if (!meta?.agent_master_enc) throw httpErr(423, 'Acesso da IA ao cofre não está ativado');
  const master = decrypt(wrapKey(meta), meta.agent_master_enc);
  return deriveKey(master, meta.salt);
}

// operações que a IA usa (via ferramentas no chat) ------------------------

export async function agentAddAccount(body) {
  const key = await agentKey();
  if (!body?.email) throw httpErr(400, 'e-mail da conta é obrigatório');
  const row = await createVaultAccount({
    label: body.label || null, email: body.email, provider: body.provider || null,
    secret_enc: encrypt(key, body.password), notes_enc: encrypt(key, body.notes)
  });
  return { id: row.id, email: row.email };
}

export async function agentAddService(body) {
  const key = await agentKey();
  if (!body?.name) throw httpErr(400, 'nome do serviço é obrigatório');
  let accountId = body.account_id || null;
  if (!accountId && body.email) {
    const acc = await findVaultAccountByEmail(body.email);
    if (acc) accountId = acc.id;
  }
  const row = await createVaultService({
    account_id: accountId, name: body.name, login: body.login || null, url: body.url || null,
    category: body.category || null, cost: numOrNull(body.cost), currency: body.currency || 'BRL',
    billing_cycle: body.billing_cycle || null, started_on: dateOrNull(body.started_on),
    expires_on: dateOrNull(body.expires_on), secret_enc: encrypt(key, body.password), notes_enc: encrypt(key, body.notes)
  });
  return { id: row.id, name: row.name, account_id: accountId };
}

// busca textual no cofre (a IA recebe os segredos decifrados pra responder)
export async function agentSearch(query) {
  const key = await agentKey();
  const q = String(query || '').trim().toLowerCase();
  const [accs, svcs] = [await listVaultAccounts(), await listVaultServices()];
  const matchAcc = (a) => !q || [a.label, a.email, a.provider].some((v) => String(v || '').toLowerCase().includes(q));
  const matchSvc = (s) => !q || [s.name, s.login, s.category, s.url].some((v) => String(v || '').toLowerCase().includes(q));
  return {
    contas: accs.filter(matchAcc).slice(0, 12).map((a) => ({
      email: a.email, apelido: a.label, provedor: a.provider,
      senha: safeDecrypt(key, a.secret_enc), notas: safeDecrypt(key, a.notes_enc)
    })),
    servicos: svcs.filter(matchSvc).slice(0, 20).map((s) => ({
      nome: s.name, login: s.login, senha: safeDecrypt(key, s.secret_enc), url: s.url,
      categoria: s.category, valor: s.cost === null ? null : Number(s.cost), moeda: s.currency,
      ciclo: s.billing_cycle, criado_em: s.started_on, expira_em: s.expires_on, notas: safeDecrypt(key, s.notes_enc)
    }))
  };
}

// ---- utils ----------------------------------------------------------------

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
function numOrNull(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function dateOrNull(v) { return v && String(v).trim() ? String(v).trim() : null; }
