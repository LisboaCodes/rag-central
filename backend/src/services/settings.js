import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Overrides feitos pelo dashboard são persistidos aqui e têm
// precedência sobre o .env (que serve como default de boot).
const SETTINGS_FILE = process.env.SETTINGS_FILE
  ? path.resolve(process.env.SETTINGS_FILE)
  : path.resolve(__dirname, '../../runtime-settings.json');

const VALID_MODES = ['auto', 'ollama', 'openai'];
const VALID_UNITS = ['tokens', 'chars'];

function defaults() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_EMBED_MODEL: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    OLLAMA_URL: (process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'nomic-embed-text',
    OLLAMA_CHAT_MODEL: process.env.OLLAMA_CHAT_MODEL || 'llama3.1',
    // Chat dos agentes (Escritório). provider 'ollama' usa OLLAMA_URL +
    // OLLAMA_CHAT_MODEL; 'openai' usa um endpoint OpenAI-compatible
    // (Groq, OpenRouter, OpenAI, ou o próprio Ollama em /v1).
    CHAT_PROVIDER: process.env.CHAT_PROVIDER || 'ollama',
    CHAT_API_BASE: (process.env.CHAT_API_BASE || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    CHAT_API_KEY: process.env.CHAT_API_KEY || '',
    CHAT_MODEL: process.env.CHAT_MODEL || 'llama-3.3-70b-versatile',
    // binário do Claude CLI (para agentes no provedor "claude-cli")
    CLAUDE_CLI_BIN: process.env.CLAUDE_CLI_BIN || 'claude',
    // GitHub: PAT para os agentes lerem/commitarem nos repos
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
    // Perplexity: pesquisa web + novidades de IA (preencher depois)
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY || '',
    PERPLEXITY_MODEL: process.env.PERPLEXITY_MODEL || 'sonar',
    // WhatsApp via evolution-api (preencher após instalar no homelab)
    WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED === 'true',
    WHATSAPP_API_URL: (process.env.WHATSAPP_API_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    WHATSAPP_API_KEY: process.env.WHATSAPP_API_KEY || '',
    WHATSAPP_INSTANCE: process.env.WHATSAPP_INSTANCE || '',
    WHATSAPP_AGENT: process.env.WHATSAPP_AGENT || 'DARLENE',
    EMBEDDING_MODE: process.env.EMBEDDING_MODE || 'auto',
    EMBEDDING_DIMS: parseInt(process.env.EMBEDDING_DIMS || '1536', 10),
    CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE || '512', 10),
    CHUNK_OVERLAP: parseInt(process.env.CHUNK_OVERLAP || '64', 10),
    CHUNK_UNIT: process.env.CHUNK_UNIT || 'tokens'
  };
}

let overrides = {};
try {
  overrides = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
} catch {
  // sem overrides ainda — usa só o .env
}

export function getSettings() {
  return { ...defaults(), ...overrides };
}

export function getSetting(key) {
  return getSettings()[key];
}

export function updateSettings(patch) {
  const allowed = Object.keys(defaults());
  const clean = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (allowed.includes(key) && value !== undefined && value !== null) {
      clean[key] = value;
    }
  }

  if (clean.OLLAMA_URL) clean.OLLAMA_URL = String(clean.OLLAMA_URL).replace(/\/+$/, '');
  if (clean.CHAT_API_BASE) clean.CHAT_API_BASE = String(clean.CHAT_API_BASE).replace(/\/+$/, '');
  if (clean.WHATSAPP_API_URL) clean.WHATSAPP_API_URL = String(clean.WHATSAPP_API_URL).replace(/\/+$/, '');
  if (clean.WHATSAPP_ENABLED !== undefined) clean.WHATSAPP_ENABLED = clean.WHATSAPP_ENABLED === true || clean.WHATSAPP_ENABLED === 'true';
  if (clean.WHATSAPP_AGENT) clean.WHATSAPP_AGENT = String(clean.WHATSAPP_AGENT).toUpperCase();
  if (clean.CHAT_PROVIDER && !['ollama', 'openai'].includes(clean.CHAT_PROVIDER)) {
    throw new Error(`CHAT_PROVIDER inválido: ${clean.CHAT_PROVIDER} (use ollama | openai)`);
  }
  for (const key of ['EMBEDDING_DIMS', 'CHUNK_SIZE', 'CHUNK_OVERLAP']) {
    if (clean[key] !== undefined) {
      const n = parseInt(clean[key], 10);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${key} inválido: ${clean[key]}`);
      clean[key] = n;
    }
  }
  if (clean.EMBEDDING_MODE && !VALID_MODES.includes(clean.EMBEDDING_MODE)) {
    throw new Error(`EMBEDDING_MODE inválido: ${clean.EMBEDDING_MODE} (use ${VALID_MODES.join(' | ')})`);
  }
  if (clean.CHUNK_UNIT && !VALID_UNITS.includes(clean.CHUNK_UNIT)) {
    throw new Error(`CHUNK_UNIT inválido: ${clean.CHUNK_UNIT} (use ${VALID_UNITS.join(' | ')})`);
  }

  overrides = { ...overrides, ...clean };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(overrides, null, 2));
  return getSettings();
}
