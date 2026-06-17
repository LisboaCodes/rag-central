import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { AGENT_HEX } from '../data/agents.js';

// Agentes agora vêm do banco (/agents) e são editáveis/criáveis.
// Este contexto carrega a lista e oferece helpers usados pela UI toda.
const AgentsContext = createContext(null);

export function hexOf(color) {
  return AGENT_HEX[color] || color || '#64748b';
}

export function AgentsProvider({ children }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.agents.list();
      setAgents(r.agents || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const byKey = useCallback(
    (key) => agents.find((a) => a.key === String(key || '').toUpperCase()) || null,
    [agents]
  );

  return (
    <AgentsContext.Provider value={{ agents, loading, error, refresh, byKey }}>
      {children}
    </AgentsContext.Provider>
  );
}

export function useAgents() {
  return useContext(AgentsContext) || { agents: [], loading: false, error: null, refresh: () => {}, byKey: () => null };
}
