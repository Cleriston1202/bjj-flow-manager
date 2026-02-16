import React, { useState } from 'react'
import { Home, Users, CheckSquare, QrCode, Wallet, Menu, X, Settings, LogOut } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'

export default function Header() {
  const [open, setOpen] = useState(false)
  const { tenant } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      if ((supabase as any).auth?.signOut) {
        await (supabase as any).auth.signOut()
      }
    } finally {
      navigate('/login', { replace: true })
    }
  }
  return (
    <header className="brand-header text-white p-4">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          {tenant?.logoUrl && (
            <img src={tenant.logoUrl} alt={tenant.organizationName} className="h-8 w-8 rounded-full object-cover bg-white" />
          )}
          <h1 className="text-xl font-semibold">{tenant?.organizationName || 'Team Bondade'}</h1>
        </div>
        <button
          className="md:hidden inline-flex items-center justify-center rounded p-2 focus:outline-none focus:ring-2 focus:ring-white"
          onClick={()=>setOpen(v=>!v)}
          aria-label="Abrir menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
        <nav className="hidden md:flex space-x-4">
          <Link to="/dashboard" className="inline-flex items-center gap-2">
            <Home size={16} /> Dashboard
          </Link>
          <Link to="/students" className="inline-flex items-center gap-2">
            <Users size={16} /> Alunos
          </Link>
          <Link to="/attendance" className="inline-flex items-center gap-2">
            <CheckSquare size={16} /> Presenças
          </Link>
          <Link to="/qr" className="inline-flex items-center gap-2">
            <QrCode size={16} /> QRs
          </Link>
          <Link to="/finance" className="inline-flex items-center gap-2">
            <Wallet size={16} /> Financeiro
          </Link>
          <button onClick={handleLogout} className="inline-flex items-center gap-2">
            <LogOut size={16} /> Sair
          </button>
          <Link to="/account" className="inline-flex items-center gap-2">
            <Settings size={16} /> Conta
          </Link>
        </nav>
      </div>
      {open && (
        <div className="md:hidden mt-2">
          <nav className="flex flex-col gap-2 bg-white/10 rounded p-3">
            <Link to="/dashboard" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <Home size={16} /> Dashboard
            </Link>
            <Link to="/students" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <Users size={16} /> Alunos
            </Link>
            <Link to="/attendance" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <CheckSquare size={16} /> Presenças
            </Link>
            <Link to="/qr" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <QrCode size={16} /> QRs
            </Link>
            <Link to="/finance" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <Wallet size={16} /> Financeiro
            </Link>
            <Link to="/account" onClick={()=>setOpen(false)} className="inline-flex items-center gap-2">
              <Settings size={16} /> Conta
            </Link>
            <button onClick={() => { setOpen(false); handleLogout() }} className="inline-flex items-center gap-2 text-left">
              <LogOut size={16} /> Sair
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
