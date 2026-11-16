import { useEffect, useRef, useState } from 'react'
import type { Agent } from '../../shared/types'

interface EditAgentDialogProps {
  agent: Agent
  onClose: () => void
  onSubmit: (patch: { name: string; role: string; about: string }) => Promise<void>
}

export function EditAgentDialog({ agent, onClose, onSubmit }: EditAgentDialogProps) {
  const [name, setName] = useState(agent.name)
  const [role, setRole] = useState(agent.role)
  const [about, setAbout] = useState(agent.about ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.select(), 60)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, pending])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !role.trim()) {
      setError('İsim ve rol zorunlu.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        role: role.trim(),
        about: about.trim(),
      })
      onClose()
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : 'Profil güncellenemedi.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <form className="dialog edit-dialog" onSubmit={submit}>
        <div className="dialog-head">
          <span className="dialog-icon">
            <span className="edit-glyph">✎</span>
          </span>
          <div>
            <h2>Profili düzenle</h2>
            <p>
              İsim ve görev tanımı arayüzden değişir; Docker profilinin
              <code> SOUL.md </code> dosyasına yazılır.
            </p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} disabled={pending}>
            ×
          </button>
        </div>

        <div className="dialog-source">
          <span
            className="dialog-avatar"
            style={{ background: agent.color, color: '#1d1913' }}
          >
            {agent.initials}
          </span>
          <div>
            <strong>{agent.name}</strong>
            <span>
              {agent.source === 'docker'
                ? `Docker · ${agent.profile ?? 'profil'} · :${agent.port ?? '—'}`
                : agent.source === 'hermes'
                  ? 'Hermes oturumu'
                  : 'Demo agent'}
            </span>
          </div>
          <span className="dialog-role-label">profil</span>
        </div>

        <div className="edit-grid">
          <div className="dialog-field">
            <label htmlFor="edit-name">İsim</label>
            <input
              id="edit-name"
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={48}
              autoComplete="off"
            />
          </div>
          <div className="dialog-field">
            <label htmlFor="edit-role">Rol</label>
            <input
              id="edit-role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              maxLength={48}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="dialog-field">
          <label htmlFor="edit-about">Görev tanımı</label>
          <textarea
            id="edit-about"
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            rows={4}
            maxLength={400}
            placeholder="Bu agent ne yapar, hangi konularda uzmandır, nasıl çalışır?"
          />
          <span className="field-hint">
            Bu metin agentın SOUL.md dosyasına eklenir; yeni oturumlarda kimliğini
            ve çalışma tarzını yönlendirir.
          </span>
        </div>

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-foot">
          <p className="dialog-note">
            {agent.source === 'docker'
              ? 'Kaydedince profil gateway’i yeniden başlatılır. Agent birkaç saniye çevrimdışı görünebilir.'
              : 'Değişiklik bu ofis oturumunda geçerli olur.'}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
              Vazgeç
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? 'Kaydediliyor…' : 'Profili kaydet'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
