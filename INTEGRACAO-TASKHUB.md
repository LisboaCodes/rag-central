# Integração CERBERUS (RAG Central) ↔ TaskHub

O TaskHub (app de tarefas/hábitos/pomodoro, Next.js) continua rodando como
**serviço próprio**. O CERBERUS o integra de duas formas, sem reescrever nada:

1. **Agentes operam o TaskHub via MCP** — o TaskHub já expõe um servidor MCP em
   `/api/mcp` com ~20 ferramentas (criar/listar tarefas, projetos, tags, hábitos,
   countdowns, pomodoro, resumo do dia, stats…). O backend do CERBERUS as injeta
   nos agentes com o prefixo `taskhub_` (ex.: `taskhub_create_task`).
2. **UI embutida** — a aba **Tarefas** na sidebar carrega o TaskHub num iframe.

Ambos compartilham o **mesmo Postgres** (tabelas convivem — não há colisão de
nomes entre os dois schemas).

## Passo a passo

### 1. TaskHub — habilitar o MCP e apontar pro mesmo Postgres
No ambiente do TaskHub (`.env` local ou envs no Coolify):

```env
# mesmo banco do RAG (a instância Postgres do homelab)
DATABASE_URL=postgresql://<user>:<senha>@<host>:5432/<db>

# habilita o servidor MCP (Bearer). Gere: openssl rand -base64 32
MCP_SECRET=<segredo-forte>
# usuário que os agentes representam (o seu)
MCP_USER_EMAIL=lisboacodes.sh@gmail.com
```

Redeploy o TaskHub. Teste: `POST https://<taskhub>/api/mcp` com header
`Authorization: Bearer <MCP_SECRET>` e body `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`.

### 2. CERBERUS — configurar em Configurações → TaskHub
- **Ativar integração com o TaskHub**: liga.
- **URL pública do TaskHub**: `https://taskhub.<seu-dominio>` (o que o iframe carrega).
- **URL do MCP**: a base acima (o `/api/mcp` é adicionado) ou o caminho completo.
- **Segredo do MCP**: o mesmo `MCP_SECRET` do passo 1.

Salve e clique **Testar conexão** / **Listar ferramentas**.

Equivalente por variáveis de ambiente do backend do CERBERUS:

```env
TASKHUB_ENABLED=true
TASKHUB_PUBLIC_URL=https://taskhub.<seu-dominio>
TASKHUB_MCP_URL=https://taskhub.<seu-dominio>/api/mcp
TASKHUB_MCP_SECRET=<mesmo MCP_SECRET>
```

## Notas
- As ferramentas do TaskHub aparecem para os agentes automaticamente (a lista é
  buscada via `tools/list` e cacheada ~5 min). Se o TaskHub estiver fora do ar, o
  chat não quebra — apenas não oferece as ferramentas.
- O MCP do TaskHub representa **um usuário fixo** (o do `MCP_USER_EMAIL`), então
  todas as tarefas criadas pelos agentes caem na sua conta.
- Login: o iframe usa a própria sessão do TaskHub (Lucia). SSO entre os dois
  painéis não está incluído — se o TaskHub exigir login, você loga uma vez dentro
  do iframe. (Evolução futura: sessão compartilhada.)
- O Cofre do CERBERUS e o "credentials" do TaskHub são recursos separados — a
  integração aqui é só MCP + embed, não fundimos features.
