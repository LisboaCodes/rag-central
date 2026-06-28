# oc-wizard

Configurador por **opções** para os agentes do [OpenClaw](https://docs.openclaw.ai).
Tudo já vem pré-configurado: você escolhe nas listas → salva → reinicia o gateway →
o agente já funciona, sem editar JSON na mão.

## Componentes

| Arquivo | Papel |
|---|---|
| `oc-wizard` | UI em `whiptail` (menus de seta). Orquestra os fluxos. |
| `oc-wizard-engine` | Backend em Python. Edita `~/.openclaw/openclaw.json` (com backup automático), grava API keys, registra providers, reinicia o gateway e roda probes. |

## Instalação

```bash
install -m 755 oc-wizard oc-wizard-engine ~/.local/bin/
# garanta ~/.local/bin no PATH (acrescente ao ~/.bashrc se preciso):
export PATH="$HOME/.local/bin:$PATH"
```

Requisitos: `whiptail`, `python3` (3.9+), e o CLI `openclaw` no PATH.

## Uso

```bash
oc-wizard
```

Menu principal:

1. **Editar agente existente** — trocar modelo, canal Discord, política de exec, identidade
2. **Criar agente novo** — mesmo fluxo, workspace auto-derivado
3. **Adicionar provedor de IA novo** — presets prontos: Z.ai (GLM), NVIDIA NIM
   (`build.nvidia.com`), HuggingFace, Moonshot/Kimi, Ollama local, ou endpoint custom
4. **Testar agora** — probe de auth ao vivo

Cada fluxo termina com: salva → pergunta se reinicia o gateway → roda o probe.

## Garantias de segurança

- Todo save faz backup (`openclaw.json.bak.wizard-<timestamp>`).
- Runtime correto aplicado sozinho (modelos Anthropic → `agentRuntime: claude-cli`).
- Bindings agente↔canal gravados no formato certo (array top-level
  `{agentId, match:{channel, accountId}}`), com reatribuição limpa de canal.
- API key gravada com permissão `600`, nunca exibida na tela (campo password).

## Detalhes técnicos

- Providers novos usam a API `openai-completions` (OpenAI-compatível), moldados no
  provider `deepseek` que já funciona.
- Para modelos com raciocínio (ex.: NVIDIA Nemotron), o thinking é ligado via
  `agents.defaults.models["<ref>"].params.extra_body`
  (`chat_template_kwargs.enable_thinking=true` + `reasoning_budget`).

## Testes

A engine tem um autoteste que roda num config temporário (não toca no real):

```bash
oc-wizard-engine selftest
```

Cobre: editar agente, criar agente, bindings top-level + reatribuição, e
registro de provider novo com key.
