import React, { useState } from 'react'
import {
  Home,
  Users,
  CheckSquare,
  QrCode,
  Wallet,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase, markManualLogout } from '../lib/supabaseClient'

const navItems = [
  { to: '/dashboard', icon: Home, label: 'Dashboard' },
  { to: '/students', icon: Users, label: 'Alunos' },
  { to: '/attendance', icon: CheckSquare, label: 'Presenças' },
  { to: '/qr', icon: QrCode, label: 'QRs' },
  { to: '/finance', icon: Wallet, label: 'Financeiro' },
]

export default function Sidebar() {
  const { tenant } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  async function handleLogout() {
    try {
      markManualLogout()
      if ((supabase as any).auth?.signOut) {
        await (supabase as any).auth.signOut()
      }
    } finally {
      navigate('/login', { replace: true })
    }
  }

  return (
    <aside
      className={`hidden md:flex flex-col border-r border-slate-800 bg-gradient-to-b from-slate-950 to-slate-900/90 text-slate-100 transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          {tenant?.logoUrl && (
            <img
              src={tenant.logoUrl}
              alt={tenant.organizationName}
              className="h-8 w-8 rounded-full object-cover bg-white"
            />
          )}
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold truncate">
                {tenant?.organizationName || 'JJ Manager'}
              </span>
              <span className="text-[11px] text-slate-400 truncate">Painel administrativo</span>
            </div>
          )}
        </div>
        <button
          type="button"
          className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-slate-300 hover:bg-slate-800"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => navigate('/account')}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/70 hover:text-white"
        >
          <Settings size={18} className="shrink-0" />
          {!collapsed && <span>Conta</span>}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-600/80 hover:text-white"
        >
          <LogOut size={18} className="shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  )
}
