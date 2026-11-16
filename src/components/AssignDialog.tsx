import { useEffect, useRef, useState } from 'react'
import type { Agent } from '../../shared/types'
import { STATUS_META } from '../lib/status'
import { foregroundFor } from '../lib/color'
import { SendIcon, SparkIcon } from './Icons'

interface AssignDialogProps {
  mode: 'task' | 'delegate'
  source: Agent
  agents: Agent[]
  onClose: () => void
  onSubmit: (payload: {
    title: string
    detail: string
    targetId?: string
  }) => Promise<void>
}

const SUGGESTIONS = [
  'Sprint planı güncellemesi',
  'Ödeme akışı gözden geçirmesi',
  'Landing page metinleri',
]

function isAvailable(agent: Agent): boolean {
  return agent.online && (agent.status === 'idle' || agent.status === 'working')
}

export function AssignDialog({
  mode,
  source,
  agents,
  onClose,
  onSubmit,
}: AssignDialogProps) {
  const candidates = agents
    .filter((agent) => agent.id !== source.id)
    .sort(
      (a, b) => b.homeFloor - a.homeFloor || a.name.localeCompare(b.name, 'tr'),
    )

  const [targetId, setTargetId] = useState<string>(
    candidates.find((agent) => isAvailable(agent))?.id ?? '',
  )
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const target = candidates.find((agent) => agent.id === targetId)
  const sourceAvailable = isAvailable(source)
  const targetAvailable = Boolean(target && isAvailable(target))

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
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
    if (!title.trim()) {
      setError('Bir görev başlığı yaz.')
      inputRef.current?.focus()
      return
    }
    if (mode === 'delegate' && !targetId) {
      setError('Bir hedef agent seç.')
      return
    }
    if (mode === 'delegate' && !targetAvailable) {
      setError('Seçili agent şu anda masasında değil. Başka birini seç.')
      return
    }
    if (!sourceAvailable) {
      setError('Kaynak agent şu anda masasında değil.')
      return
    }

    setPending(true)
    setError(null)
    try {
      await onSubmit({
        title: title.trim(),
        detail: detail.trim(),
        targetId: mode === 'delegate' ? targetId : undefined,
      })
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'İşlem tamamlanamadı.')
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
      <form className="dialog" onSubmit={submit}>
        <div className="dialog-head">
          <span className="dialog-icon">
            {mode === 'delegate' ? <SendIcon size={18} /> : <SparkIcon size={18} />}
          </span>
          <div>
            <h2>{mode === 'delegate' ? 'İş devri' : 'Görev ver'}</h2>
            <p>
              {mode === 'delegate'
                ? `${source.name}, seçtiğin agentın masasına gidip işi teslim edecek.`
                : `Görev doğrudan ${source.name} agentına atanır.`}
            </p>
          </div>
          <button type="button" className="dialog-close" onClick={onClose} disabled={pending}>
            ×
          </button>
        </div>

        <div className="dialog-source">
          <span
            className="dialog-avatar"
            style={{ background: source.color, color: foregroundFor(source.color) }}
          >
            {source.initials}
          </span>
          <div>
            <strong>{source.name}</strong>
            <span>
              {source.role} · KAT {source.floor}
            </span>
          </div>
          <span className="dialog-role-label">
            {mode === 'delegate' ? 'devreden' : 'görev sahibi'}
          </span>
        </div>

        {mode === 'delegate' && (
          <div className="dialog-field">
            <label>Kime devredilsin?</label>
            <div className="target-list">
              {candidates.map((agent) => {
                const meta = STATUS_META[agent.status]
                const selected = agent.id === targetId
                const available = isAvailable(agent)
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`target-row ${selected ? 'selected' : ''} ${
                      available ? '' : 'unavailable'
                    }`}
                    onClick={() => {
                      setTargetId(agent.id)
                      setError(null)
                    }}
                    disabled={!available}
                    title={available ? undefined : 'Agent şu anda masasında değil'}
                  >
                    <span
                      className="target-avatar"
                      style={{ background: agent.color, color: foregroundFor(agent.color) }}
                    >
                      {agent.initials}
                    </span>
                    <span className="target-name">
                      <strong>{agent.name}</strong>
                      <small>
                        {agent.role} · KAT {agent.homeFloor}
                        {agent.floor !== agent.homeFloor
                          ? ` · şu an K${agent.floor}`
                          : ''}
                      </small>
                    </span>
                    <span className="target-status" style={{ color: meta.color }}>
                      <i style={{ background: meta.color }} />
                      {meta.label}
                    </span>
                    <span className={`target-radio ${selected ? 'selected' : ''}`} />
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {mode === 'delegate' && target && (
          <div className="route-preview">
            <span className="route-dot" style={{ background: source.color }} />
            <span>KAT {source.homeFloor}</span>
            <span className="route-line">
              <i />
              <b>{source.homeFloor === target.homeFloor ? 'aynı kat' : 'asansör'}</b>
            </span>
            <span>KAT {target.homeFloor}</span>
            <span className="route-dot" style={{ background: target.color }} />
            <span className="route-target">{target.name}</span>
          </div>
        )}

        {mode === 'delegate' && target && !targetAvailable && (
          <div className="dialog-warning">
            {target.name} şu anda masasında değil ({STATUS_META[target.status].label}).
            Müsait bir agent seç.
          </div>
        )}

        {!sourceAvailable && (
          <div className="dialog-warning">
            {source.name} şu anda masasında değil. Devir için agentın masasına dönmesini bekle.
          </div>
        )}

        <div className="dialog-field">
          <label htmlFor="task-title">Görev başlığı</label>
          <input
            id="task-title"
            ref={inputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Örn. Ödeme akışı gözden geçirmesi"
            maxLength={140}
            autoComplete="off"
          />
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setTitle(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div className="dialog-field">
          <label htmlFor="task-detail">
            Not <span>opsiyonel</span>
          </label>
          <textarea
            id="task-detail"
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Kısa bir bağlam veya kabul kriteri..."
            rows={3}
            maxLength={280}
          />
        </div>

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-foot">
          <p className="dialog-note">
            {mode === 'delegate'
              ? 'Agent yürür, işi teslim eder ve masasına döner. Tüm adımlar ofiste canlı görünür.'
              : 'Görev, agentın kartında ve akışta görünür.'}
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
              Vazgeç
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                pending ||
                !sourceAvailable ||
                (mode === 'delegate' && (!targetId || !targetAvailable))
              }
            >
              {pending
                ? 'Gönderiliyor…'
                : mode === 'delegate'
                  ? 'Devret ve izle'
                  : 'Görevi başlat'}
            </button>          </div>
        </div>
      </form>
    </div>
  )
}
