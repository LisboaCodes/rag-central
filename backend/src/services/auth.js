import crypto from 'crypto';
import { getSettings, updateSettings } from './settings.js';
import { sendLoginCode } from './email.js';
import { sendText } from './whatsapp.js';
import { logEvent } from './activity.js';

// Login em 2 fatores, sem dependências externas:
//   fator 1  -> código de 6 dígitos por e-mail (Resend)
//   fator 2  -> código de 6 dígitos por WhatsApp (evolution-api)
// Sessão = token assinado com HMAC-SHA256 (sem libs de JWT).

const CODE_TTL_MS = 5 * 60 * 1000;     // código de verificação expira em 5 min
const MAX_ATTEMPTS = 5;                 // tentativas erradas antes de invalidar o desafio

// desafios de login em andamento (em memória — single user, ok reiniciar)
// email -> { stage, emailCode, waCode, expiresAt, attempts }
const challenges = new Map();

// ---- helpers de config ----------------------------------------------------

export function authEnabled() {
  return getSettings().AUTH_ENABLED === true;
}

function allowedEmails() {
  return String(getSettings().AUTH_ALLOWED_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isAllowed(email) {
  const list = allowedEmails();
  if (!list.length) return false;
  return list.includes(String(email || '').trim().toLowerCase());
}

// segredo de assinatura — gera e persiste na 1ª vez
function sessionSecret() {
  let s = getSettings().AUTH_SESSION_SECRET;
  if (!s) {
    s = crypto.randomBytes(48).toString('hex');
    updateSettings({ AUTH_SESSION_SECRET: s });
  }
  return s;
}

// ---- token de sessão (HMAC) ----------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(JSON.stringify(obj)); }
function fromB64url(str) { return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); }

export function issueToken(email) {
  const ttlH = getSettings().AUTH_SESSION_TTL_HOURS || 12;
  const payload = {
    sub: String(email).toLowerCase(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlH * 3600
  };
  const head = b64urlJson({ alg: 'HS256', typ: 'CRB' });
  const body = b64urlJson(payload);
  const sig = b64url(crypto.createHmac('sha256', sessionSecret()).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', sessionSecret()).update(`${head}.${body}`).digest());
  // comparação em tempo constante
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString('utf8')); } catch { return null; }
  if (!payload?.exp || payload.exp * 1000 < Date.now()) return null;
  return payload;
}

// hash estável do token (chaveia a sessão do Cofre sem guardar o token cru)
export function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---- fluxo de login -------------------------------------------------------

function genCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// passo 1: usuário informa o e-mail -> manda código por e-mail (Resend)
export async function startLogin(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) throw httpErr(400, 'Informe o e-mail');
  if (!isAllowed(mail)) {
    logEvent('WARN', 'auth', `login negado para e-mail não autorizado: ${mail}`);
    throw httpErr(403, 'E-mail não autorizado');
  }
  const code = genCode();
  challenges.set(mail, { stage: 'email', emailCode: code, waCode: null, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 });
  await sendLoginCode(mail, code);
  logEvent('INFO', 'auth', `código de login enviado por e-mail para ${mail}`);
  return { stage: 'email', sentTo: maskEmail(mail) };
}

// passo 2: confere o código do e-mail -> manda o 2º fator por WhatsApp
export async function verifyEmailCode(email, code) {
  const mail = String(email || '').trim().toLowerCase();
  const ch = getValidChallenge(mail, 'email');
  if (!constEq(code, ch.emailCode)) return failAttempt(mail, ch, 'Código do e-mail incorreto');

  const s = getSettings();
  const num = s.AUTH_2FA_NUMBER;
  if (!num) throw httpErr(500, 'AUTH_2FA_NUMBER (WhatsApp do 2º fator) não configurado');
  const waCode = genCode();
  ch.stage = 'whatsapp';
  ch.waCode = waCode;
  ch.expiresAt = Date.now() + CODE_TTL_MS;
  ch.attempts = 0;
  await sendText(num, `CERBERUS · seu código de 2ª etapa é ${waCode} (expira em 5 min).`);
  logEvent('INFO', 'auth', `2º fator enviado por WhatsApp para ${mail}`);
  return { stage: 'whatsapp', sentTo: maskNumber(num) };
}

// passo 3: confere o 2º fator -> emite o token de sessão
export async function verify2faCode(email, code) {
  const mail = String(email || '').trim().toLowerCase();
  const ch = getValidChallenge(mail, 'whatsapp');
  if (!constEq(code, ch.waCode)) return failAttempt(mail, ch, 'Código do WhatsApp incorreto');
  challenges.delete(mail);
  const token = issueToken(mail);
  logEvent('INFO', 'auth', `login concluído: ${mail}`);
  return { token, email: mail, ttlHours: getSettings().AUTH_SESSION_TTL_HOURS || 12 };
}

// ---- middleware -----------------------------------------------------------

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// exige sessão válida. Usado nas rotas sensíveis (Cofre) e no gate global.
export function requireAuth(req, res, next) {
  const token = bearer(req);
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Não autenticado' });
  req.user = { email: payload.sub };
  req.authToken = token;
  next();
}

// gate global: se AUTH_ENABLED, exige sessão em tudo, menos nas rotas públicas.
const PUBLIC_PREFIXES = ['/auth', '/status'];
export function authGate(req, res, next) {
  if (!authEnabled()) return next();
  if (req.method === 'OPTIONS') return next();
  if (PUBLIC_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  return requireAuth(req, res, next);
}

// ---- utilitários ----------------------------------------------------------

function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

function getValidChallenge(mail, stage) {
  const ch = challenges.get(mail);
  if (!ch || ch.expiresAt < Date.now()) { challenges.delete(mail); throw httpErr(400, 'Código expirado — recomece o login'); }
  if (ch.stage !== stage) throw httpErr(400, 'Etapa inválida — recomece o login');
  return ch;
}

function failAttempt(mail, ch, msg) {
  ch.attempts += 1;
  if (ch.attempts >= MAX_ATTEMPTS) { challenges.delete(mail); throw httpErr(429, 'Muitas tentativas — recomece o login'); }
  throw httpErr(401, msg);
}

function constEq(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function maskEmail(mail) {
  const [u, d] = mail.split('@');
  if (!d) return mail;
  const head = u.length <= 2 ? u[0] : u.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}
function maskNumber(num) {
  const s = String(num);
  return s.length <= 4 ? s : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}
