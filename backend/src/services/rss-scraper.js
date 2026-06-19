import Parser from 'rss-parser';
import { pool } from './db.js';
import { ingestText } from './ingest.js';
import { logEvent } from './activity.js';
import { notify } from './notify.js';

// Scraper de RSS — alimenta a base de conhecimento automaticamente com as
// últimas novidades de IA/tech. Reutiliza ingestText (mesmo pipeline da rota
// /ingest). Dedup por URL em tabela no Postgres.

const parser = new Parser({
  timeout: 20000,
  headers: { 'User-Agent': 'RAG-Central-RSS/1.0' }
});

const FEEDS = [
  { name: 'OpenAI', url: 'https://openai.com/blog/rss.xml' },
  { name: 'Anthropic', url: 'https://www.anthropic.com/rss.xml' },
  { name: 'HuggingFace', url: 'https://huggingface.co/blog/feed.xml' },
  { name: 'VentureBeat', url: 'https://feeds.feedburner.com/venturebeat/SZYF' },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' }
];

const PROJECT = 'novidades-ia';
const PER_SOURCE = 5;

const state = { lastSync: null, lastResult: null, running: false };

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rss_seen (
      url         TEXT PRIMARY KEY,
      title       TEXT,
      source      TEXT,
      ingested_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

const clean = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Processa UM feed (erros isolados — não derruba os outros).
async function syncFeed(feed) {
  const parsed = await parser.parseURL(feed.url);
  const items = (parsed.items || []).slice(0, PER_SOURCE);
  let ingested = 0;
  const titles = [];
  for (const it of items) {
    const url = it.link || it.guid;
    if (!url) continue;
    const seen = await pool.query('SELECT 1 FROM rss_seen WHERE url = $1', [url]);
    if (seen.rowCount) continue;

    const title = clean(it.title) || '(sem título)';
    const summary = clean(it.contentSnippet || it.content || it.summary || it['content:encoded']).slice(0, 4000);
    const date = it.isoDate || it.pubDate || null;
    const text = `# ${title}\n\nFonte: ${feed.name}\nURL: ${url}\nData: ${date || '—'}\n\n${summary}`;

    await ingestText({
      project: PROJECT,
      sourcePath: url,
      text,
      replace: false,
      metadata: { type: 'rss', source: feed.name, title, url, date }
    });
    await pool.query(
      'INSERT INTO rss_seen (url, title, source) VALUES ($1, $2, $3) ON CONFLICT (url) DO NOTHING',
      [url, title, feed.name]
    );
    ingested++;
    titles.push(`${feed.name}: ${title.slice(0, 70)}`);
    logEvent('INFO', 'rss', `ingerido [${feed.name}] ${title.slice(0, 70)}`);
  }
  return { ingested, titles };
}

// Roda o scraper em todas as fontes. Erros por fonte são isolados.
export async function syncRss() {
  if (state.running) return state.lastResult || { running: true };
  state.running = true;
  const result = { sources: {}, total: 0, errors: [], startedAt: new Date().toISOString() };
  const newTitles = [];
  try {
    await ensureTable();
    for (const feed of FEEDS) {
      try {
        const { ingested, titles } = await syncFeed(feed);
        result.sources[feed.name] = ingested;
        result.total += ingested;
        newTitles.push(...titles);
      } catch (err) {
        result.sources[feed.name] = `erro: ${err.message}`;
        result.errors.push({ source: feed.name, error: err.message });
        logEvent('ERROR', 'rss', `falha em ${feed.name}: ${err.message}`);
      }
    }
  } finally {
    state.running = false;
    state.lastSync = new Date().toISOString();
    state.lastResult = result;
  }
  logEvent('INFO', 'rss', `sync concluída: ${result.total} artigos novos (${result.errors.length} fontes com erro)`);
  if (newTitles.length) {
    const list = newTitles.slice(0, 8).map((t) => `• ${t}`).join('\n');
    const extra = newTitles.length > 8 ? `\n… +${newTitles.length - 8}` : '';
    notify(`📰 *Novidades de IA* (${newTitles.length})\n${list}${extra}`, { flag: 'NOTIFY_NEWS', key: 'rss-batch', cooldown: 60 * 1000 });
  }
  return result;
}

export async function getRssStatus() {
  let totalIngested = 0;
  try {
    await ensureTable();
    totalIngested = (await pool.query('SELECT COUNT(*)::int AS n FROM rss_seen')).rows[0].n;
  } catch { /* db off */ }
  return {
    lastSync: state.lastSync,
    running: state.running,
    totalIngested,
    sources: FEEDS.map((f) => f.name),
    lastResult: state.lastResult
  };
}

// Agenda: roda 1x logo após o boot e depois a cada 6 horas.
export function startRssSchedule() {
  setTimeout(() => { syncRss().catch((e) => logEvent('ERROR', 'rss', e.message)); }, 30000);
  setInterval(() => { syncRss().catch((e) => logEvent('ERROR', 'rss', e.message)); }, 6 * 60 * 60 * 1000);
  logEvent('INFO', 'rss', 'agendador de RSS ativo (a cada 6h)');
}
