import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { ArrowRightIcon } from './Icons'

export function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!sent) return
    const timer = window.setTimeout(() => setFailed(true), 1800)
    return () => window.clearTimeout(timer)
  }, [sent])

  return (
    <div className="gate">
      <div className="gate-grid" aria-hidden="true" />
      <div className="gate-card">
        <BrandMark size={46} />
        <span className="gate-kicker">KODMOZ OFİS</span>
        <h1>Ofis kilitli</h1>
        <p>
          Sunucu bir erişim token'ı istiyor. Ofise girmek için <code>OFFICE_TOKEN</code>{' '}
          değerini gir.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!token.trim()) return
            setSent(true)
            setFailed(false)
            onSubmit(token.trim())
          }}
        >
          <label htmlFor="office-token">Erişim token'ı</label>
          <div className="gate-input-row">
            <input
              id="office-token"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value)
                setSent(false)
                setFailed(false)
              }}
              placeholder="Token"
              autoFocus
              autoComplete="current-password"
            />
            <button type="submit" className="btn btn-primary" disabled={!token.trim()}>
              Ofise gir
              <ArrowRightIcon />
            </button>
          </div>
        </form>
        {sent && !failed && <div className="gate-status">Token kontrol ediliyor…</div>}
        {failed && (
          <div className="gate-error">
            Token doğrulanamadı. Değeri kontrol edip tekrar dene.
          </div>
        )}
        <small>Token yalnızca bu tarayıcıda saklanır. Sunucuda değiştirilirse yeniden girmen gerekir.</small>
      </div>
    </div>
  )
}
