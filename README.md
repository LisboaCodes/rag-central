# 🧠 RAG Central

Base de conhecimento unificada para os agentes (Mel, MarkZuck, Darlene, Joanna)
e projetos pessoais. Ingestão de documentos → chunking → embeddings
(Ollama com fallback OpenAI) → pgvector → busca semântica via API REST +
dashboard web.

## Arquitetura

```
Fontes (.md, código, docs, PDFs)
        ↓
Ingestor/Chunker (configurável: tokens ou chars, overlap)
        ↓
Embedding Service ─ tenta Ollama (LXC 101, nomic-embed-text, grátis)
                  └ fallback OpenAI (text-embedding-3-small, pago)
        ↓
pgvector (LXC 100, PostgreSQL 17, índice HNSW)
        ↓
API REST (Node/Express) ← dashboard React e agentes via HTTP
```

## Endpoints da API

| Método | Rota               | Descrição                                          |
|--------|--------------------|----------------------------------------------------|
| POST   | `/query`           | `{question, project?, agent?, top_k?, mode?}` → top-K chunks com score |
| POST   | `/ingest`          | multipart (`file`) ou JSON (`text`) + `project` → chunka, embeda e salva |
| POST   | `/ingest/preview`  | mesmo input, retorna os chunks sem salvar          |
| GET    | `/sources`         | fontes agrupadas (projeto, arquivo, chunks, modelo, data) |
| GET    | `/sources/projects`| lista de projetos                                  |
| GET    | `/sources/chunks`  | `?project=&source_path=` → chunks de uma fonte     |
| POST   | `/sources/reindex` | re-embeda uma fonte com o modo atual               |
| DELETE | `/sources`         | `{project, source_path}` → apaga a fonte           |
| GET    | `/status`          | saúde, contadores, stats por projeto/tipo/modelo, série de consultas 24h, stats por agente |
| GET    | `/logs`            | eventos em memória (`?level=&service=&limit=`) — resetam no restart |
| GET/PUT| `/config`          | configurações em runtime (modo, URLs, chunking)    |
| POST   | `/config/test`     | `{service: 'db'\|'ollama'\|'openai'}` → testa a conexão real |

O campo `agent` no `/query` identifica quem consultou (ex: `"agent": "mel"`) —
alimenta os contadores por agente no dashboard.

### Exemplo — consulta de um agente

```bash
curl -s http://IP_DA_API:3000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "como configurar o deploy?", "project": "meu-projeto", "agent": "mel", "top_k": 5}'
```

### Exemplo — ingestão via CLI (loop nos .md do workspace)

```bash
for f in /root/.openclaw/workspace/*.md; do
  curl -s http://IP_DA_API:3000/ingest \
    -F "file=@$f" -F "project=openclaw-agents" -F "source_path=$f"
done
```

## ⚠️ Decisão importante: dimensões e mistura de modelos

A coluna é `vector(1536)` (padrão OpenAI). Embeddings do Ollama (768 dims)
recebem **padding com zeros** até 1536 — isso não altera a similaridade de
cosseno entre vetores do mesmo modelo.

Porém, **comparar vetores de modelos diferentes não faz sentido semântico**.
Por isso o `/query` filtra por `embedding_model` igual ao usado na pergunta
(desligável com `"match_model": false`). Consequência prática: se a base foi
indexada via Ollama e o Ollama cair, a busca em modo auto vai usar OpenAI e
retornar 0 resultados. Soluções: re-indexar as fontes (botão "Re-indexar" no
dashboard ou `POST /sources/reindex`) ou fixar um único modo de embedding.
**Recomendação: assim que o LXC 101 estiver de pé, force `EMBEDDING_MODE=ollama`
e indexe tudo com ele.**

## Desenvolvimento local

Pré-requisitos: Node.js 20+ (ideal 22). Postgres com pgvector — use o LXC 100
direto ou o docker-compose local:

```bash
docker compose up -d postgres        # opcional: + ollama
```

**Backend:**

```bash
cd backend
cp .env.example .env                 # edite DATABASE_URL etc.
npm install
npm run dev                          # http://localhost:3000
```

O schema é criado automaticamente no boot (ou rode `npm run init-db`, ou
aplique `../schema.sql` manualmente via psql).

**Frontend:**

```bash
cd frontend
npm install
npm run dev                          # http://localhost:5173 (proxy /api → :3000)
```

## Produção no Proxmox (LXC dedicado pra API + dashboard)

Sugestão: criar um LXC Debian 12 (ex: **LXC 102 — rag-central**), 2 vCPU / 2 GB.

### 1. Banco (LXC 100)

```bash
# dentro do LXC 100
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'SENHA_FORTE';"
# liberar acesso de rede (ajuste a subnet):
# postgresql.conf  → listen_addresses = '*'
# pg_hba.conf      → host all all 10.0.0.0/24 scram-sha-256
systemctl restart postgresql
psql -U postgres -d postgres -f schema.sql   # ou deixe o backend criar no boot
```

### 2. Ollama (LXC 101)

```bash
# dentro do LXC 101 (quando existir)
curl -fsSL https://ollama.com/install.sh | sh
# expor na rede (Ollama escuta só em localhost por padrão):
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF
systemctl daemon-reload && systemctl restart ollama
ollama pull nomic-embed-text
```

Enquanto o LXC 101 não existir, deixe `EMBEDDING_MODE=auto` — a API funciona
só com OpenAI e o dashboard mostra o Ollama como offline.

### 3. API (LXC 102)

```bash
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs

git clone <repo> /opt/rag-central
cd /opt/rag-central/backend
cp .env.example .env && nano .env    # DATABASE_URL, OLLAMA_URL, OPENAI_API_KEY
npm install --omit=dev

cat > /etc/systemd/system/rag-central.service <<'EOF'
[Unit]
Description=RAG Central API
After=network.target

[Service]
WorkingDirectory=/opt/rag-central/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
EnvironmentFile=/opt/rag-central/backend/.env
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl enable --now rag-central
curl http://localhost:3000/status    # sanity check
```

### 4. Dashboard (mesmo LXC, servido por nginx)

```bash
cd /opt/rag-central/frontend
npm install && npm run build         # gera dist/

apt install -y nginx
cat > /etc/nginx/sites-available/rag-central <<'EOF'
server {
  listen 80;
  root /opt/rag-central/frontend/dist;
  index index.html;

  # SPA: rotas do React Router caem no index.html
  location / { try_files $uri /index.html; }

  # o front chama /api/*; o nginx tira o prefixo e repassa pra API
  location /api/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    client_max_body_size 30m;
  }
}
EOF
ln -sf /etc/nginx/sites-available/rag-central /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Dashboard em `http://IP_LXC102/`, API direta (pros agentes) em
`http://IP_LXC102:3000/`.

## Segurança

Sem autenticação por enquanto — **mantenha acessível apenas na rede
local/VPN** (firewall do Proxmox ou do LXC). JWT simples fica pra fase 2.

## Estrutura

```
rag-central/
├── backend/
│   └── src/
│       ├── index.js              # Express, rotas, error handler
│       ├── routes/               # query, ingest, sources, status, config
│       ├── services/
│       │   ├── embedding.js      # Ollama + fallback OpenAI + padding 768→1536
│       │   ├── chunker.js        # janela deslizante c/ quebras naturais
│       │   ├── db.js             # pool pg + queries pgvector (HNSW/cosseno)
│       │   └── settings.js       # .env + overrides do dashboard persistidos
│       └── scripts/init-db.js
├── frontend/                     # React 18 + Vite + Tailwind v4, dark mode
│   └── src/pages/                # Dashboard, Ingest, Sources, Search, Settings
├── schema.sql
└── docker-compose.yml            # postgres+pgvector (e ollama) pra dev local
```
