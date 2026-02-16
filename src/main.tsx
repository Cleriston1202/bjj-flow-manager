import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tailwind.css'
import { AuthProvider } from './lib/AuthContext'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
