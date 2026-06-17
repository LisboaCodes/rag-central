import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingest from './pages/Ingest.jsx';
import Sources from './pages/Sources.jsx';
import Search from './pages/Search.jsx';
import Agents from './pages/Agents.jsx';
import Office from './pages/Office.jsx';
import GitHubPage from './pages/GitHub.jsx';
import Conversas from './pages/Conversas.jsx';
import Novidades from './pages/Novidades.jsx';
import Logs from './pages/Logs.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ingest" element={<Ingest />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/search" element={<Search />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/office" element={<Office />} />
        <Route path="/github" element={<GitHubPage />} />
        <Route path="/conversas" element={<Conversas />} />
        <Route path="/novidades" element={<Novidades />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
