import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

// /status é consumido pela sidebar, header e dashboard — uma única
// busca compartilhada com refresh a cada 15s.
const StatusContext = createContext(null);

export function StatusProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.status());
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <StatusContext.Provider value={{ status, error, updatedAt, refresh }}>
      {children}
    </StatusContext.Provider>
  );
}

export function useStatus() {
  return useContext(StatusContext);
}
