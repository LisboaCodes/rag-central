import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initSchema } from './services/db.js';
import { startRssSchedule } from './services/rss-scraper.js';
import { startNotifySchedule } from './services/notify.js';
import { startCronSchedule } from './services/cron.js';
import queryRouter from './routes/query.js';
import chatRouter from './routes/chat.js';
import conversationsRouter from './routes/conversations.js';
import agentsRouter from './routes/agents.js';
import githubRouter from './routes/github.js';
import whatsappRouter from './routes/whatsapp.js';
import newsRouter from './routes/news.js';
import modelsRouter from './routes/models.js';
import ingestRouter from './routes/ingest.js';
import sourcesRouter from './routes/sources.js';
import memoryRouter from './routes/memory.js';
import cronRouter from './routes/cron.js';
import statusRouter from './routes/status.js';
import configRouter from './routes/config.js';
import logsRouter from './routes/logs.js';
import authRouter from './routes/auth.js';
import vaultRouter from './routes/vault.js';
import projectsRouter from './routes/projects.js';
import { authGate } from './services/auth.js';
import { logEvent } from './services/activity.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// healthcheck público (Coolify/uptime) — responde 200 SEMPRE, mesmo com o
// login ligado (fica antes do authGate). Evita deploy "Failed" por healthcheck.
app.get(['/health', '/healthz'], (req, res) => res.json({ ok: true, ts: Date.now() }));

// rotas de login (sempre públicas)
app.use('/auth', authRouter);

// gate global: se AUTH_ENABLED estiver ligado, exige sessão em tudo
// (menos /auth e /status). Desligado = comportamento atual (painel aberto).
app.use(authGate);

app.use('/vault', vaultRouter);
app.use('/projects', projectsRouter);
app.use('/query', queryRouter);
app.use('/chat', chatRouter);
app.use('/conversations', conversationsRouter);
app.use('/agents', agentsRouter);
app.use('/github', githubRouter);
app.use('/whatsapp', whatsappRouter);
app.use('/news', newsRouter);
app.use('/models', modelsRouter);
app.use('/ingest', ingestRouter);
app.use('/sources', sourcesRouter);
app.use('/memory', memoryRouter);
app.use('/cron', cronRouter);
app.use('/status', statusRouter);
app.use('/config', configRouter);
app.use('/logs', logsRouter);

app.get('/', (req, res) => {
  res.json({
    name: 'RAG Central API',
    endpoints: ['POST /query', 'POST /chat', 'POST /ingest', 'POST /ingest/preview', 'GET /sources', 'GET /status', 'GET /config']
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Erro interno' });
});

const port = parseInt(process.env.PORT || '3000', 10);

// Cria tabela/índices se não existirem; se o banco estiver fora,
// a API sobe mesmo assim e o /status reporta o problema.
initSchema()
  .then(() => {
    console.log('[db] schema verificado/criado');
    logEvent('INFO', 'db', 'Schema verificado — tabela documents e índices OK');
  })
  .catch((err) => {
    console.warn(`[db] não foi possível inicializar o schema agora: ${err.message}`);
    logEvent('WARN', 'db', `Banco indisponível no boot: ${err.message}`);
  });

app.listen(port, '0.0.0.0', () => {
  console.log(`RAG Central API ouvindo em http://0.0.0.0:${port}`);
  logEvent('INFO', 'api', `Servidor iniciado na porta ${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  // scraper de RSS: roda logo após o boot e a cada 6h
  startRssSchedule();
  // notificações por WhatsApp (resumo diário do cérebro)
  startNotifySchedule();
  // tarefas agendadas (CRON) — carrega do banco e agenda
  startCronSchedule();
});
