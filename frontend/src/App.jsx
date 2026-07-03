import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingest from './pages/Ingest.jsx';
import Sources from './pages/Sources.jsx';
import Memoria from './pages/Memoria.jsx';
import Cerebro from './pages/Cerebro.jsx';
import Cofre from './pages/Cofre.jsx';
import Projetos from './pages/Projetos.jsx';
import Tarefas from './pages/Tarefas.jsx';
import Agendamentos from './pages/Agendamentos.jsx';
import Search from './pages/Search.jsx';
import Agents from './pages/Agents.jsx';
import GitHubPage from './pages/GitHub.jsx';
import Conversas from './pages/Conversas.jsx';
import Novidades from './pages/Novidades.jsx';
import Logs from './pages/Logs.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';

// Office é 3D (Three.js, pesado) — carrega só quando a rota é aberta,
// mantendo o bundle principal leve.
const Office = lazy(() => import('./pages/Office.jsx'));

function Loading() {
  return <p className="py-20 text-center text-sm text-muted">Carregando o escritório 3D…</p>;
}

// Bloqueia o app quando o login está ligado e a sessão não é válida.
function Gate({ children }) {
  const { ready, authed } = useAuth();
  if (!ready) return <p className="py-20 text-center text-sm text-muted">Carregando…</p>;
  if (!authed) return <Login />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ingest" element={<Ingest />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/memoria" element={<Memoria />} />
            <Route path="/cerebro" element={<Cerebro />} />
            <Route path="/cofre" element={<Cofre />} />
            <Route path="/projetos" element={<Projetos />} />
            <Route path="/tarefas" element={<Tarefas />} />
            <Route path="/agendamentos" element={<Agendamentos />} />
            <Route path="/search" element={<Search />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/office" element={<Suspense fallback={<Loading />}><Office /></Suspense>} />
            <Route path="/github" element={<GitHubPage />} />
            <Route path="/conversas" element={<Conversas />} />
            <Route path="/novidades" element={<Novidades />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </Gate>
    </AuthProvider>
  );
}
