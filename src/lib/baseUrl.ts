export function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  const explicit = process.env.NEXT_PUBLIC_APP_BASE_URL
  if (explicit) {
    return explicit
  }

  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) {
    return `https://${vercelUrl}`
  }

  return 'http://localhost:3000'
}
