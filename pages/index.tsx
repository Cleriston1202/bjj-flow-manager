import React from 'react'
import dynamic from 'next/dynamic'

// Usa o mesmo wrapper SPA do catch-all, sem SSR
const NextRoot = dynamic(() => import('../src/NextRoot'), { ssr: false })

export default function IndexPage() {
  return <NextRoot />
}
