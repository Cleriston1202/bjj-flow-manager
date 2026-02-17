import React from 'react'
import dynamic from 'next/dynamic'

// Importa o wrapper do SPA apenas no cliente para evitar erros de SSR
const NextRoot = dynamic(() => import('../src/NextRoot'), { ssr: false })

// Rota "catch-all" que renderiza o SPA atual (React Router)
// em qualquer caminho (/ , /login, /dashboard, etc.).
export default function RootPage() {
  return <NextRoot />
}

