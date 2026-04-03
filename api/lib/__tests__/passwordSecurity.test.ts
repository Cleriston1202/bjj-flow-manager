import { describe, it, expect, vi, afterEach } from 'vitest'
import { isLeakedPassword, assertPasswordIsNotLeaked } from '../passwordSecurity'
import crypto from 'crypto'

// ─── helpers ─────────────────────────────────────────────────────────────────

function sha1Upper(value: string) {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').toUpperCase()
}

/** Builds a fake HIBP response body that contains the given suffix with `count` occurrences */
function hibpBody(suffix: string, count: number): string {
  return `${suffix}:${count}\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0\n`
}

function mockFetch(body: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

// ─── isLeakedPassword ─────────────────────────────────────────────────────────

describe('isLeakedPassword', () => {
  it('retorna leaked=true quando o hash está na resposta da HIBP', async () => {
    const password = 'password123'
    const hash = sha1Upper(password)
    const suffix = hash.slice(5)

    mockFetch(hibpBody(suffix, 42))

    const result = await isLeakedPassword(password)
    expect(result.leaked).toBe(true)
    expect(result.count).toBe(42)
  })

  it('retorna leaked=false quando o hash não está na resposta', async () => {
    mockFetch('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n')

    const result = await isLeakedPassword('senha-muito-unica-xyz-987654321')
    expect(result.leaked).toBe(false)
    expect(result.count).toBe(0)
  })

  it('envia somente o prefixo de 5 chars para a API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    const password = 'test-prefix-check'
    const prefix = sha1Upper(password).slice(0, 5)

    await isLeakedPassword(password)

    expect(fetchMock).toHaveBeenCalledOnce()
    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain(prefix)
    // garante que o suffix NÃO está na URL (k-anonymity)
    const suffix = sha1Upper(password).slice(5)
    expect(calledUrl).not.toContain(suffix)
  })

  it('lança erro com mensagem de timeout quando a API demora demais', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    )

    await expect(isLeakedPassword('qualquer')).rejects.toThrow('HIBP API unavailable (timeout)')
  })

  it('lança erro quando a API retorna status não-200', async () => {
    mockFetch('', 503)

    await expect(isLeakedPassword('qualquer')).rejects.toThrow('HIBP API unavailable (503)')
  })

  it('trata senha vazia sem lançar erro', async () => {
    mockFetch('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1\n')

    const result = await isLeakedPassword('')
    expect(result).toHaveProperty('leaked')
  })

  it('trata linhas malformadas na resposta sem travar', async () => {
    mockFetch('linha-sem-dois-pontos\n:sem-suffix\n')

    const result = await isLeakedPassword('qualquer')
    expect(result.leaked).toBe(false)
  })
})

// ─── assertPasswordIsNotLeaked ────────────────────────────────────────────────

describe('assertPasswordIsNotLeaked', () => {
  it('lança erro em português quando a senha está vazada', async () => {
    const password = 'senha123'
    const hash = sha1Upper(password)
    const suffix = hash.slice(5)

    mockFetch(hibpBody(suffix, 1000))

    await expect(assertPasswordIsNotLeaked(password)).rejects.toThrow(
      'Esta senha já apareceu em vazamentos públicos.'
    )
  })

  it('resolve sem erro quando a senha não está vazada', async () => {
    mockFetch('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0\n')

    await expect(assertPasswordIsNotLeaked('senha-segura-unica-xyz')).resolves.toBeUndefined()
  })

  it('propaga erro de API para o chamador', async () => {
    mockFetch('', 500)

    await expect(assertPasswordIsNotLeaked('qualquer')).rejects.toThrow('HIBP API unavailable')
  })
})
