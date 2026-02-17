import React from 'react'
import App from './App'
import { AuthProvider } from './lib/AuthContext'

export default function NextRoot() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  )
}
