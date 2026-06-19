import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingest from './pages/Ingest.jsx';
import Sources from './pages/Sources.jsx';
import Memoria from './pages/Memoria.jsx';
import Cerebro from './pages/Cerebro.jsx';
import Agendamentos from './pages/Agendamentos.jsx';
import Search from './pages/Search.jsx';
import Agents from './pages/Agents.jsx';
import GitHubPage from './pages/GitHub.jsx';
import Conversas from './pages/Conversas.jsx';
import Novidades from './pages/Novidades.jsx';
import Logs from './pages/Logs.jsx';
import Settings from './pages/Settings.jsx';

// Office é 3D (Three.js, pesado) — carrega só quando a rota é aberta,
// mantendo o bundle principal leve.
const Office = lazy(() => import('./pages/Office.jsx'));

function Loading() {
  return <p className="py-20 text-center text-sm text-muted">Carregando o escritório 3D…</p>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ingest" element={<Ingest />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/memoria" element={<Memoria />} />
        <Route path="/cerebro" element={<Cerebro />} />
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
  );
}
