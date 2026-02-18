
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Zap, History, LogOut, Terminal, UserCircle } from 'lucide-react';
import { mockAuth } from '../mockStorage';

interface LayoutProps {
  children: React.ReactNode;
  user: string;
  onLogout: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, user, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    mockAuth.logout();
    onLogout();
    navigate('/login');
  };

  const navItems = [
    { name: 'Optimizer', path: '/optimize', icon: Zap },

    { name: 'Profile', path: '/profile', icon: UserCircle },
  ];

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-gray-200 overflow-hidden">
      <aside className="w-64 border-r border-gray-800 flex flex-col bg-[#0d0d0d]">
        <div className="p-6 flex items-center gap-3 cursor-pointer" onClick={() => navigate('/')}>
          <div className="bg-blue-600 p-2 rounded-lg">
            <Terminal className="text-white w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">OptiCode</h1>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                location.pathname === item.path
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-600/20 shadow-lg shadow-blue-500/5'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon className={`w-5 h-5 ${location.pathname === item.path ? 'text-blue-400' : 'text-gray-500'}`} />
              <span className="font-semibold text-sm">{item.name}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-all group"
          >
            <LogOut className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="font-medium text-sm">Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 border-b border-gray-800 flex items-center justify-between px-8 bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-[0.2em]">
            
          </div>
          <div className="flex items-center gap-4 cursor-pointer hover:opacity-80 transition-all" onClick={() => navigate('/profile')}>
            <div className="flex flex-col items-end">
               <span className="text-xs text-gray-500 uppercase font-bold tracking-widest">Member</span>
               <span className="text-sm font-bold text-white">{user}</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 border border-white/10 flex items-center justify-center text-xs font-extrabold shadow-lg">
              {user[0].toUpperCase()}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-8 scrollbar-hide">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
