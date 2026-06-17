import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initSchema } from './services/db.js';
import queryRouter from './routes/query.js';
import chatRouter from './routes/chat.js';
import conversationsRouter from './routes/conversations.js';
import agentsRouter from './routes/agents.js';
import githubRouter from './routes/github.js';
import whatsappRouter from './routes/whatsapp.js';
import newsRouter from './routes/news.js';
import ingestRouter from './routes/ingest.js';
import sourcesRouter from './routes/sources.js';
import statusRouter from './routes/status.js';
import configRouter from './routes/config.js';
import logsRouter from './routes/logs.js';
import { logEvent } from './services/activity.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.use('/query', queryRouter);
app.use('/chat', chatRouter);
app.use('/conversations', conversationsRouter);
app.use('/agents', agentsRouter);
app.use('/github', githubRouter);
app.use('/whatsapp', whatsappRouter);
app.use('/news', newsRouter);
app.use('/ingest', ingestRouter);
app.use('/sources', sourcesRouter);
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
});
