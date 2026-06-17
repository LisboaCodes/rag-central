import { useLocation } from 'react-router-dom';
import { Menu, Moon, Bell } from 'lucide-react';
import { NAV } from './Sidebar.jsx';

export default function Header({ onMenu }) {
  const { pathname } = useLocation();
  const current = NAV.find((n) => n.to === pathname) || NAV[0];

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-edge bg-header px-4 py-3 md:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-body lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="text-lg font-bold leading-tight">{current.title}</h1>
          <p className="text-xs text-muted">{current.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <button className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-body" aria-label="Tema">
          <Moon size={18} />
        </button>
        <button className="relative rounded-lg p-2 text-muted hover:bg-white/5 hover:text-body" aria-label="Notificações">
          <Bell size={18} />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            3
          </span>
        </button>
        <div className="ml-1 flex items-center gap-3 border-l border-edge pl-3 md:pl-4">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">Rafael</p>
            <p className="text-[10px] text-muted">Administrador</p>
          </div>
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-sm font-bold text-white">
              R
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-header" />
          </div>
        </div>
      </div>
    </header>
  );
}
