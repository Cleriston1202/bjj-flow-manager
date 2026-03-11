import crypto from 'crypto'

const HIBP_RANGE_API = 'https://api.pwnedpasswords.com/range/'

function sha1HexUpper(value: string) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase()
}

export async function isLeakedPassword(password: string): Promise<{ leaked: boolean; count: number }> {
  const hash = sha1HexUpper(String(password || ''))
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let response: Response
  try {
    response = await fetch(`${HIBP_RANGE_API}${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
      },
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('HIBP API unavailable (timeout)')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`HIBP API unavailable (${response.status})`)
  }

  const body = await response.text()
  const lines = body.split(/\r?\n/)

  for (const line of lines) {
    const [candidateSuffix, count] = line.split(':')
    if (!candidateSuffix || !count) continue
    if (candidateSuffix.trim().toUpperCase() === suffix) {
      return { leaked: true, count: Number(count) || 0 }
    }
  }

  return { leaked: false, count: 0 }
}

export async function assertPasswordIsNotLeaked(password: string): Promise<void> {
  const result = await isLeakedPassword(password)
  if (result.leaked) {
    throw new Error('Esta senha já apareceu em vazamentos públicos. Escolha outra senha.')
  }
}
