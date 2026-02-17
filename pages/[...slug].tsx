import React from 'react'
import dynamic from 'next/dynamic'

// Importa o wrapper do SPA apenas no cliente para evitar erros de SSR
const NextRoot = dynamic(() => import('../src/NextRoot'), { ssr: false })

// Rota catch-all não opcional: corresponde a qualquer caminho exceto "/",
// que já está coberto por pages/index.tsx.
export default function RootCatchAllPage() {
  return <NextRoot />
}
