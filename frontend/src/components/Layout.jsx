import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import Header from './Header.jsx';
import { StatusProvider } from '../lib/StatusContext.jsx';
import { AgentsProvider } from '../lib/AgentsContext.jsx';

export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <StatusProvider>
     <AgentsProvider>
      <div className="min-h-screen">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
        <div className="lg:pl-[220px]">
          <Header onMenu={() => setMenuOpen(true)} />
          <main className="p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
     </AgentsProvider>
    </StatusProvider>
  );
}
