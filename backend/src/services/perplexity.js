import axios from 'axios';
import { getSettings } from './settings.js';

// Perplexity (API OpenAI-compatible com busca web + citações).
// Usado pela ferramenta pesquisar_web e pelo quadro de novidades de IA.

export function perplexityEnabled() {
  return Boolean(getSettings().PERPLEXITY_API_KEY);
}

/**
 * Pergunta à Perplexity com acesso à web.
 * @param {string} prompt
 * @param {{ system?: string, recency?: 'day'|'week'|'month' }} [opts]
 * @returns {Promise<{ text: string, citations: string[] }>}
 */
export async function askPerplexity(prompt, opts = {}) {
  const s = getSettings();
  if (!s.PERPLEXITY_API_KEY) throw new Error('PERPLEXITY_API_KEY não configurada (Configurações → Perplexity)');

  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });

  try {
    const { data } = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: s.PERPLEXITY_MODEL || 'sonar',
        messages,
        temperature: 0.2,
        ...(opts.recency ? { search_recency_filter: opts.recency } : {})
      },
      {
        timeout: 45000,
        headers: { Authorization: `Bearer ${s.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' }
      }
    );
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const citations = data?.citations || data?.search_results?.map((r) => r.url) || [];
    return { text, citations };
  } catch (err) {
    throw new Error(`Perplexity: ${err.response?.data?.error?.message || err.message}`);
  }
}
