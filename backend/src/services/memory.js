import { completeChat } from './chat.js';
import { getConversation, insertChunks } from './db.js';
import { embedBatched } from './embedding.js';
import { chunkText } from './chunker.js';

// Consolida uma conversa em FATOS duráveis e os guarda na base vetorial
// (projeto "memoria-consolidada"), pra memória de longo prazo continuar
// afiada sem precisar reprocessar a conversa inteira toda vez.
export async function consolidateConversation(conversationId) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new Error('conversa não encontrada');
  if (!conv.messages.length) throw new Error('conversa sem mensagens');

  const transcript = conv.messages
    .map((m) => `${m.role === 'user' ? 'Usuário' : (m.agent || 'Agente')}: ${m.content}`)
    .join('\n')
    .slice(0, 12000);

  const messages = [
    {
      role: 'system',
      content:
        'Você resume conversas em FATOS duráveis para memória de longo prazo de um time de agentes. ' +
        'Extraia somente o que vale lembrar no futuro: decisões, preferências do usuário, dados concretos, ' +
        'combinados e pendências. Ignore saudações e conversa fiada. Responda em português, em tópicos curtos e objetivos.'
    },
    { role: 'user', content: `Resuma a conversa abaixo em fatos para memória:\n\n${transcript}` }
  ];

  const { answer } = await completeChat(messages);

  const header = `# Memória consolidada — conversa #${conversationId} (${conv.agent})\n\n`;
  const chunks = chunkText(header + answer, { chunkSize: 512, overlap: 64, unit: 'tokens' });
  const { embeddings, model } = await embedBatched(chunks);
  await insertChunks({
    project: 'memoria-consolidada',
    sourcePath: `conversa-${conversationId}.md`,
    chunks, embeddings, model,
    metadata: { type: 'memory_summary', conversation_id: conversationId, agent: conv.agent }
  });

  return { summary: answer, chunks: chunks.length };
}
