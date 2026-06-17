// Roster dos agentes do OpenClaw. As estatísticas em runtime
// (total de consultas, última query) vêm de /status → activity.agents,
// indexadas pelo nome em maiúsculas — basta o agente mandar
// { "agent": "mel" } no POST /query.

export const AGENT_ROSTER = [
  { name: 'MEL', model: 'Claude Sonnet 4.6', role: 'Engenheira Chefe', color: 'purple' },
  { name: 'MARKZUCK', model: 'Claude Opus 4.8', role: 'Especialista Tráfego Pago', color: 'green' },
  { name: 'DARLENE', model: 'GPT-5.5', role: 'Secretária Executiva', color: 'gold' },
  { name: 'JOANNA', model: 'DeepSeek', role: 'Social Media', color: 'blue' }
];

// Cores em hex (para canvas e estilos inline), indexadas por color do roster.
export const AGENT_HEX = {
  purple: '#7c3aed',
  green: '#059669',
  gold: '#d97706',
  blue: '#2563eb',
  orange: '#ea580c'
};

export const agentByName = (name) =>
  AGENT_ROSTER.find((a) => a.name === String(name || '').toUpperCase());

