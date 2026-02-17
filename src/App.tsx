import React, { JSX } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom'

import Dashboard from './pages/Dashboard'
import Students from './pages/Students'
import Attendance from './pages/Attendance'
import StudentProfile from './pages/StudentProfile'
import StudentQR from './pages/StudentQR'
import QRExport from './pages/QRExport'
import Header from './components/Header'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Finance from './pages/Finance'
import AccountSettings from './pages/AccountSettings'
import { useAuth } from './lib/AuthContext'
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'

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
  const hideHeader = location.pathname.startsWith('/meu-qr')
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  React.useEffect(() => {
    if (loading) return
    if (user && (location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/')) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, loading, location.pathname, navigate])

  return (
    <div className="min-h-screen bg-white text-black">
      {!hideHeader && <Header />}
      <main className="p-4">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/finance" element={<RequireAuth><Finance /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><AccountSettings /></RequireAuth>} />
          <Route path="/students" element={<RequireAuth><Students /></RequireAuth>} />
          <Route path="/students/:id" element={<RequireAuth><StudentProfile /></RequireAuth>} />
          <Route path="/attendance" element={<RequireAuth><Attendance /></RequireAuth>} />
          <Route path="/checkin/:organizationId" element={<Attendance />} />
          <Route path="/qr" element={<RequireAuth><QRExport /></RequireAuth>} />
          <Route path="/meu-qr/:studentId" element={<StudentQR />} />
        </Routes>
      </main>
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
