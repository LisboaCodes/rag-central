# RAG Central — Guia de Setup e Próximos Passos

> **Documento de continuidade.** Estado do projeto + roteiro técnico completo
> para colocar o RAG Central rodando 100% em produção no homelab Proxmox.
> Última atualização: 2026-06-14.
>
> **Decisão tomada:** criar o **LXC 101 (Ollama) primeiro** — embeddings
> gratuitos e locais como provedor principal. OpenAI fica como fallback
> opcional (fase posterior).

---

## 0. Estado atual — o que JÁ está pronto

O código está 100% escrito e testado localmente (sem banco real ainda).
Nada falta implementar no software; o que falta é **infraestrutura**.

| Componente | Estado | Observação |
|------------|--------|------------|
| Backend Node/Express | ✅ Pronto | Todas as rotas funcionando; testado sem banco (degradação graciosa) |
| Frontend React/Vite/Tailwind | ✅ Pronto | Dashboard fiel ao `ref.png`, integrado à API real |
| Schema SQL (pgvector) | ✅ Pronto | Cria-se sozinho no boot do backend |
| Telemetria (logs, stats, agentes) | ✅ Pronto | Em memória, reseta no restart |
| **PostgreSQL acessível na rede** | ❌ Pendente | LXC 100 existe, mas só escuta localhost + sem senha definida |
| **LXC 101 (Ollama)** | ❌ Não existe | Precisa ser criado do zero |
| **Backend apontado pro banco real** | ❌ Pendente | Falta preencher o `.env` |
| **Deploy de produção** | ❌ Pendente | Opcional; roda em dev primeiro |

### Caminho crítico (resumo visual)

```
[1] PostgreSQL acessível (LXC 100)  ──┐
                                       ├──> [3] Backend .env ──> [4] Primeiro ingest ──> [5] Deploy
[2] Ollama no ar (LXC 101 — criar) ───┘
```

Sem **[1]** e **[2]**, nada funciona de verdade. São os dois bloqueadores.

---

## 1. Mapa da infraestrutura

| LXC | Hostname | Papel | Estado | IP |
|-----|----------|-------|--------|-----|
| 100 | postgres-db | PostgreSQL 17 + pgvector 0.8.2 | Existe | ⚠️ confirmar |
| 101 | ollama | Ollama + nomic-embed-text | **Criar** | — |
| 102 | rag-central | API Node + dashboard (nginx) | Criar (fase 5) | — |

- **Host Proxmox:** `homelabs` — Debian, kernel 6.17.2-1-pve, 16 CPUs.
- **Rede:** todos os LXCs na mesma bridge (`vmbr0`). Anote a subnet
  (ex: `10.0.0.0/24`) — você vai precisar dela no `pg_hba.conf`.

> 💡 **Dica:** rode `pct list` no host Proxmox para ver todos os containers,
> seus IDs e status. Para descobrir o IP de um container existente:
> `pct exec 100 -- ip -4 addr show eth0 | grep inet`

---

## 2. FASE 1 — PostgreSQL acessível na rede (LXC 100)

**Por quê:** por padrão o PostgreSQL só aceita conexões de `localhost`. O
backend vai rodar em outro LXC (ou no seu PC em dev), então precisa que o
banco aceite conexões de rede. Além disso, conexão por rede exige senha
(autenticação `scram-sha-256`).

### 2.1. Entrar no container e definir a senha

```bash
# no host Proxmox:
pct enter 100

# dentro do LXC 100 — define a senha do superusuário postgres:
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'TROQUE_POR_UMA_SENHA_FORTE';"
```

> 🔐 Guarde essa senha — ela vai no `DATABASE_URL` do backend. Evite
> caracteres que quebram URL (`@ : / ? #`); se usar, terá que fazer
> URL-encode deles.

### 2.2. Descobrir a versão do PostgreSQL e o caminho dos configs

```bash
# dentro do LXC 100:
sudo -u postgres psql -c "SHOW config_file;"
# normalmente: /etc/postgresql/17/main/postgresql.conf
```

### 2.3. Fazer o PostgreSQL escutar na rede

Edite `/etc/postgresql/17/main/postgresql.conf` (use `nano` ou `vi`):

```ini
# procure a linha "listen_addresses" e deixe assim:
listen_addresses = '*'        # escuta em todas as interfaces
# (opcional, default já é 5432)
port = 5432
```

### 2.4. Liberar a subnet no pg_hba.conf

Edite `/etc/postgresql/17/main/pg_hba.conf` e adicione **no final**:

```
# RAG Central — permite a subnet do homelab (AJUSTE a subnet!)
host    all    all    10.0.0.0/24    scram-sha-256
```

> ⚠️ Troque `10.0.0.0/24` pela sua subnet real. Se não souber, descubra com
> `ip -4 addr show eth0` dentro do LXC — ex: se o IP é `10.0.0.100/24`, a
> subnet é `10.0.0.0/24`. Para ser mais restritivo (recomendado), libere só
> o IP do futuro LXC 102: `host all all 10.0.0.102/32 scram-sha-256`.

### 2.5. Reiniciar e validar

```bash
# dentro do LXC 100:
sudo systemctl restart postgresql
sudo systemctl status postgresql      # deve estar "active (running)"

# confirme que está escutando na rede (não só 127.0.0.1):
ss -tlnp | grep 5432                   # deve aparecer 0.0.0.0:5432
```

### 2.6. Teste de fora (do seu PC ou outro LXC)

```bash
# substitua IP_LXC100 e a senha:
psql "postgresql://postgres:SENHA@IP_LXC100:5432/postgres" -c "SELECT version();"

# confirme que a extensão pgvector está ativa:
psql "postgresql://postgres:SENHA@IP_LXC100:5432/postgres" -c "SELECT extversion FROM pg_extension WHERE extname='vector';"
# deve retornar 0.8.2
```

✅ **Se esses dois comandos funcionarem, a FASE 1 está concluída** — o passo
mais difícil de toda a montagem.

---

## 3. FASE 2 — Criar o LXC 101 (Ollama)

**Por quê:** o Ollama é o motor de embeddings gratuito e local. O modelo
`nomic-embed-text` gera vetores de 768 dimensões e roda bem em CPU (não
precisa de GPU para embeddings desse porte). O container não existe ainda —
vamos criá-lo do zero.

### 3.1. Criar o container (no host Proxmox)

**Opção A — pela interface web do Proxmox:**
1. Botão **Create CT** (canto superior direito).
2. **CT ID:** 101 · **Hostname:** ollama · senha de root à sua escolha.
3. **Template:** Debian 12 standard (baixe em *local > CT Templates* se não tiver).
4. **Disk:** 20 GB · **Cores:** 4 · **Memory:** 4096 MB · **Swap:** 2048 MB.
5. **Network:** bridge `vmbr0`, IPv4 = DHCP (ou IP estático, ver nota abaixo).
6. Marque **Start after created**.

**Opção B — por linha de comando (mais rápido):**

```bash
# no host Proxmox:

# 1. baixar o template Debian 12 (se ainda não tiver):
pveam update
pveam available | grep debian-12
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

# 2. criar o container:
pct create 101 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname ollama \
  --cores 4 \
  --memory 4096 \
  --swap 2048 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1 \
  --password

# 3. iniciar:
pct start 101
pct enter 101
```

> 📌 **IP estático (recomendado):** se quiser um IP fixo para não ter que
> reconfigurar o backend quando o DHCP mudar, troque `ip=dhcp` por
> `ip=10.0.0.101/24,gw=10.0.0.1` (ajuste para sua rede). Anote esse IP — é o
> `OLLAMA_URL` do backend.

> 💪 **Recursos:** 4 vCPU / 4 GB é confortável para `nomic-embed-text`.
> Embeddings em CPU são rápidos para textos curtos; uma ingestão grande
> processa em lotes (o backend já faz isso). Se a RAM apertar, suba para
> 6-8 GB.

### 3.2. Instalar o Ollama (dentro do LXC 101)

```bash
# dentro do LXC 101:
apt update && apt install -y curl
curl -fsSL https://ollama.com/install.sh | sh
```

### 3.3. ⚠️ Expor o Ollama na rede (passo crítico)

Por padrão o Ollama escuta **só em `127.0.0.1`** — o backend em outro LXC não
conseguiria alcançá-lo. Precisamos forçá-lo a escutar em `0.0.0.0`:

```bash
# dentro do LXC 101:
mkdir -p /etc/systemd/system/ollama.service.d

cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF

systemctl daemon-reload
systemctl restart ollama
systemctl status ollama        # deve estar "active (running)"
```

### 3.4. Puxar o modelo de embedding

```bash
# dentro do LXC 101:
ollama pull nomic-embed-text

# confirme que baixou:
ollama list                    # deve listar nomic-embed-text
```

### 3.5. Validar (de fora do container)

```bash
# do seu PC ou de outro LXC — troque IP_LXC101:

# a API responde na rede?
curl http://IP_LXC101:11434/api/tags

# gera embedding de verdade? (deve retornar um array de 768 números)
curl http://IP_LXC101:11434/api/embed \
  -d '{"model": "nomic-embed-text", "input": "teste de embedding"}'
```

✅ **Se o `/api/embed` retornar um vetor, a FASE 2 está concluída.**

---

## 4. FASE 3 — Configurar e subir o Backend

Pode rodar primeiro **em dev no seu PC** (mais fácil de depurar) e só depois
mover para o LXC 102. O código é o mesmo.

### 4.1. Preencher o `.env`

```bash
cd rag-central/backend
cp .env.example .env
```

Edite `.env` com os dados reais coletados nas fases anteriores:

```ini
# Banco (FASE 1)
DATABASE_URL=postgresql://postgres:SUA_SENHA@IP_LXC100:5432/postgres

# Ollama (FASE 2) — preferencial
OLLAMA_URL=http://IP_LXC101:11434
OLLAMA_MODEL=nomic-embed-text

# OpenAI — deixe vazio por enquanto (fallback opcional, fase futura)
OPENAI_API_KEY=

# Embedding — IMPORTANTE: fixar em ollama (ver nota sobre dimensões abaixo)
EMBEDDING_MODE=ollama
EMBEDDING_DIMS=1536

# Chunking (padrões; ajustáveis no dashboard)
CHUNK_SIZE=512
CHUNK_OVERLAP=64
CHUNK_UNIT=tokens

# App
PORT=3000
NODE_ENV=production
```

> 🎯 **Por que `EMBEDDING_MODE=ollama` e não `auto`?** Leia a seção
> **"Decisão crítica: dimensões e mistura de modelos"** abaixo. Em resumo:
> misturar embeddings de modelos diferentes na mesma base quebra a busca.
> Como você vai indexar tudo com Ollama, fixe nele desde o início.

### 4.2. Instalar dependências e subir

```bash
cd rag-central/backend
npm install
npm run dev        # ou: npm start (produção)
```

No boot, o backend:
1. Conecta no banco e **cria a tabela `documents` + índices automaticamente**
   (não precisa rodar o `schema.sql` à mão).
2. Começa a escutar em `http://0.0.0.0:3000`.

### 4.3. Validar a saúde do sistema

```bash
curl http://localhost:3000/status
```

No JSON de resposta, confirme:
- `database.connected: true` e `database.pgvector: "0.8.2"`
- `ollama.online: true` e `ollama.model_available: true`
- `embedding.effective_provider: "ollama"`

✅ Tudo `true` = backend conectado de verdade aos dois serviços.

---

## 5. FASE 4 — Primeiro ingest e validação da busca

### 5.1. Subir o frontend (dev)

```bash
cd rag-central/frontend
npm install
npm run dev        # http://localhost:5173 (proxy /api → :3000)
```

Abra `http://localhost:5173`. O dashboard deve mostrar PostgreSQL, pgvector e
Ollama todos **Online** (verde) na sidebar.

### 5.2. Ingerir os primeiros documentos

**Pela interface:** página **Ingestão** → arraste um `.md` → escolha/digite o
projeto → "Gerar preview" → "Iniciar Ingestão".

**Por linha de comando (lote dos .md do workspace dos agentes):**

```bash
for f in /root/.openclaw/workspace/*.md; do
  curl -s http://IP_DA_API:3000/ingest \
    -F "file=@$f" \
    -F "project=openclaw-agents" \
    -F "source_path=$f"
done
```

### 5.3. Testar a busca semântica

**Pela interface:** página **Busca Semântica** → digite uma pergunta → veja os
chunks com score de similaridade.

**Por linha de comando (como os agentes vão consultar):**

```bash
curl -s http://IP_DA_API:3000/query \
  -H 'Content-Type: application/json' \
  -d '{"question": "qual o papel da agente Mel?", "project": "openclaw-agents", "agent": "mel", "top_k": 5}'
```

✅ Se retornar chunks relevantes com `similarity` alto, **o RAG está
funcionando 100% de verdade.**

---

## 6. FASE 5 — Deploy de produção (LXC 102) — *opcional*

Quando estiver tudo validado em dev, mova para um LXC dedicado para a API +
dashboard rodarem 24/7.

### 6.1. Criar o LXC 102 (Debian 12, 2 vCPU / 2 GB) — mesmo processo da FASE 3.1

### 6.2. Instalar Node 22 e clonar o projeto

```bash
# dentro do LXC 102:
apt update && apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

git clone <SEU_REPO> /opt/rag-central
cd /opt/rag-central/backend
cp .env.example .env && nano .env        # mesmos valores da FASE 3.1
npm install --omit=dev
```

### 6.3. Rodar o backend como serviço (systemd)

```bash
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
curl http://localhost:3000/status        # sanity check
```

### 6.4. Servir o dashboard com nginx

```bash
cd /opt/rag-central/frontend
npm install && npm run build              # gera dist/

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

- Dashboard: `http://IP_LXC102/`
- API direta (para os agentes): `http://IP_LXC102:3000/`

---

## 7. ⚠️ Decisão crítica: dimensões e mistura de modelos

**Leia isto antes de indexar qualquer coisa.**

A coluna do banco é `vector(1536)` (padrão OpenAI). O `nomic-embed-text` gera
**768 dimensões** — o backend faz **padding com zeros** até 1536. Isso é
seguro: não altera a similaridade de cosseno entre vetores **do mesmo modelo**.

O perigo é **misturar modelos**: comparar um vetor do nomic com um vetor da
OpenAI produz similaridades sem sentido (ruído). Por isso:

- O `/query` **filtra por `embedding_model`** igual ao da pergunta. Se a base
  foi indexada com Ollama e você consultar em modo OpenAI, retorna **0
  resultados** (correto, mas confuso se não souber o motivo).
- **Recomendação:** fixe `EMBEDDING_MODE=ollama` e indexe **tudo** com ele.
  Consistência total.

**E se um dia quiser adicionar OpenAI como fallback?** Tudo bem — mas saiba que
chunks indexados via OpenAI só serão encontrados por queries via OpenAI. Para
unificar, use o botão **"Re-indexar"** no dashboard (ou `POST /sources/reindex`)
para regerar os embeddings de uma fonte com o modelo atual.

---

## 8. Troubleshooting (erros comuns)

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| `/status` → `database.connected: false` + `ECONNREFUSED` | Postgres não escuta na rede | Revisar FASE 2.3/2.4 (listen_addresses + pg_hba) e reiniciar |
| `/status` → erro de autenticação | Senha errada ou `pg_hba` sem `scram-sha-256` | Conferir senha no `DATABASE_URL` e a linha do `pg_hba.conf` |
| `ollama.online: false` no dashboard | Ollama só em localhost | Revisar FASE 3.3 (override `OLLAMA_HOST=0.0.0.0`) e reiniciar |
| `ollama.model_available: false` | Modelo não baixado | `ollama pull nomic-embed-text` no LXC 101 |
| Ingest falha com "nenhum provedor disponível" | Ollama offline E sem OpenAI key | Subir o Ollama ou configurar `OPENAI_API_KEY` |
| Busca retorna 0 resultados sempre | Base indexada com modelo diferente do da query | Re-indexar as fontes ou alinhar `EMBEDDING_MODE` |
| Firewall do Proxmox bloqueia | Portas 5432/11434/3000 fechadas | Liberar no firewall do datacenter/LXC |

**Comandos de diagnóstico rápido:**

```bash
# o banco aceita conexão de rede?
psql "postgresql://postgres:SENHA@IP_LXC100:5432/postgres" -c "SELECT 1;"

# o Ollama responde na rede?
curl http://IP_LXC101:11434/api/tags

# a API enxerga os dois?
curl http://localhost:3000/status | jq '.database.connected, .ollama.online'
```

---

## 9. Checklist final de "funcionar 100%"

Marque conforme avança:

- [ ] **FASE 1** — `psql` externo conecta no LXC 100 e vê pgvector 0.8.2
- [ ] **FASE 2** — `curl .../api/embed` no LXC 101 retorna vetor de 768 dims
- [ ] **FASE 3** — `.env` preenchido; `npm run dev` sobe sem erro
- [ ] **FASE 3** — `/status` mostra `database.connected`, `ollama.online` e
      `effective_provider: "ollama"` todos OK
- [ ] **FASE 4** — primeira ingestão concluída (dashboard mostra a fonte)
- [ ] **FASE 4** — busca semântica retorna chunks com score relevante
- [ ] **FASE 5** (opcional) — backend como systemd + dashboard no nginx no LXC 102

Quando todos os itens da FASE 1 a 4 estiverem marcados, o RAG Central está
**operacional de verdade** e os agentes (Mel, MarkZuck, Darlene, Joanna) já
podem consultar via `POST /query`.

---

## 10. Referência rápida

### Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/query` | `{question, project?, agent?, top_k?, mode?}` → top-K chunks |
| POST | `/ingest` | multipart (`file`) ou JSON (`text`) + `project` |
| POST | `/ingest/preview` | mesmo input, retorna chunks sem salvar |
| GET | `/sources` | fontes agrupadas |
| GET | `/sources/projects` | lista de projetos |
| GET | `/sources/chunks` | `?project=&source_path=` |
| POST | `/sources/reindex` | re-embeda uma fonte com o modo atual |
| DELETE | `/sources` | `{project, source_path}` |
| GET | `/status` | saúde + stats + série 24h + agentes |
| GET | `/logs` | `?level=&service=&limit=` |
| GET/PUT | `/config` | configurações em runtime |
| POST | `/config/test` | `{service: 'db'\|'ollama'\|'openai'}` |

### Dados a coletar durante o setup (preencha conforme avança)

```
IP do LXC 100 (Postgres):  ___________________
Senha do postgres:         ___________________
IP do LXC 101 (Ollama):    ___________________
IP do LXC 102 (API, fase 5): _________________
Subnet do homelab:         ___________________  (ex: 10.0.0.0/24)
```

### Agentes que vão consumir o RAG

| Agente | Modelo | Papel |
|--------|--------|-------|
| Mel | Claude Sonnet 4.6 | Engenheira Chefe |
| MarkZuck | Claude Opus 4.8 | Tráfego Pago |
| Darlene | GPT-5.5 | Secretária Executiva / Finanças |
| Joanna | DeepSeek | Social Media / Conteúdo |

Cada agente se identifica no `POST /query` com `{"agent": "mel"}` — isso
alimenta os contadores por agente no dashboard.

---

**Próximo passo imediato quando você retomar:** começar pela **FASE 1**
(deixar o PostgreSQL do LXC 100 acessível na rede). É o bloqueador principal e
o passo mais delicado. Tendo o `psql` externo conectando, o resto flui.
