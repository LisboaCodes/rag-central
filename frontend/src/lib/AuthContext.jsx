import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken, onUnauthorized } from './api.js';

// Controla o estado de login. Se o backend reportar AUTH desligado, a app
// segue aberta (comportamento atual). Ligado, exige sessão válida.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [user, setUser] = useState(null);

  const boot = useCallback(async () => {
    try {
      const cfg = await api.auth.config();
      setEnabled(cfg.enabled);
      if (cfg.enabled && getToken()) {
        try {
          const me = await api.auth.me();
          setUser(me);
        } catch {
          setToken('');
          setUser(null);
        }
      }
    } catch {
      // backend fora / sem rota -> trata como desativado pra não travar a app
      setEnabled(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);

  // quando um request der 401, derruba a sessão
  useEffect(() => {
    onUnauthorized(() => setUser(null));
  }, []);

  const login = useCallback((token, email) => {
    setToken(token);
    setUser({ email });
  }, []);

  const logout = useCallback(() => {
    setToken('');
    setUser(null);
  }, []);

  const authed = !enabled || Boolean(user);

  return (
    <AuthContext.Provider value={{ ready, enabled, user, authed, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
