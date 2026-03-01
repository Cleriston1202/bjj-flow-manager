import React, { JSX } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom'

import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Attendance from './pages/Attendance'
import StudentProfile from './pages/StudentProfile'
import StudentQR from './pages/StudentQR'
import QRExport from './pages/QRExport'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import Finance from './pages/Finance'
import AccountSettings from './pages/AccountSettings'
import ClassSchedules from './pages/ClassSchedules'
import { useAuth } from './lib/AuthContext'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'

function hasRecoveryParams(location: { search: string; hash: string }) {
  const query = new URLSearchParams(location.search)
  const hashRaw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash
  const hash = new URLSearchParams(hashRaw)
  const type = query.get('type') || hash.get('type') || ''
  const hasToken = !!(
    query.get('token_hash') ||
    query.get('token') ||
    hash.get('token_hash') ||
    hash.get('token') ||
    hash.get('access_token') ||
    query.get('access_token') ||
    query.get('refresh_token') ||
    hash.get('refresh_token') ||
    query.get('code') ||
    hash.get('code')
  )
  const hasRecoveryHint = type === 'recovery' || query.get('redirect_to')?.includes('forgot-password') || false
  return hasToken || hasRecoveryHint
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [expired, setExpired] = React.useState(false)

  React.useEffect(() => {
    if (loading) return
    if (!user) return
    try {
      const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 1 dia
      const key = 'session_started_at'
      const now = Date.now()
      if (typeof window === 'undefined') return
      const stored = window.localStorage.getItem(key)
      if (!stored) {
        window.localStorage.setItem(key, String(now))
        return
      }
      const startedAt = parseInt(stored, 10)
      if (!Number.isNaN(startedAt) && now - startedAt > MAX_AGE_MS) {
        setExpired(true)
        try {
          window.localStorage.removeItem(key)
        } catch {
          // ignore storage errors
        }
        if (isSupabaseConfigured && (supabase as any).auth?.signOut) {
          ;(supabase as any).auth.signOut()
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [user, loading])

  if (loading) return <div className="p-4">Carregando...</div>
  if (!user || expired) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

function AppLayout() {
  const location = useLocation()
  const isStudentQR = location.pathname.startsWith('/meu-qr')
  const isKioskCheckin = location.pathname.startsWith('/checkin')
  const isAuthPage = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password'
  const shellLess = isStudentQR || isKioskCheckin || isAuthPage
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  React.useEffect(() => {
    if (location.pathname !== '/forgot-password' && hasRecoveryParams(location)) {
      navigate(`/forgot-password${location.search}${location.hash}`, { replace: true })
      return
    }

    if (loading) return
    if (user && (location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/')) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, loading, location.pathname, location.search, location.hash, navigate])

  const routes = (
    <Routes>
      <Route
        path="/"
        element={
          hasRecoveryParams(location)
            ? <Navigate to={`/forgot-password${location.search}${location.hash}`} replace />
            : <Navigate to="/login" replace />
        }
      />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/finance" element={<RequireAuth><Finance /></RequireAuth>} />
      <Route path="/account" element={<RequireAuth><AccountSettings /></RequireAuth>} />
      <Route path="/students" element={<RequireAuth><Students /></RequireAuth>} />
      <Route path="/students/:id" element={<RequireAuth><StudentProfile /></RequireAuth>} />
      <Route path="/attendance" element={<RequireAuth><Attendance /></RequireAuth>} />
      <Route path="/classes" element={<RequireAuth><ClassSchedules /></RequireAuth>} />
      <Route path="/checkin/:organizationId" element={<Attendance />} />
      <Route path="/qr" element={<RequireAuth><QRExport /></RequireAuth>} />
      <Route path="/meu-qr" element={<StudentQR />} />
      <Route path="/meu-qr/:studentId" element={<StudentQR />} />
    </Routes>
  )

  if (shellLess) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50">
        <main className="min-h-screen">
          {routes}
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <header className="md:hidden">
          <Header />
        </header>
        <main className="flex-1 px-4 py-4 lg:px-8 lg:py-6 bg-slate-950">
          {routes}
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
