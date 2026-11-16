import { useState } from 'react'
import type { Agent, OfficeEvent } from '../../shared/types'
import { EVENT_META, elapsedLabel, relativeTime } from '../lib/status'
import { ArrowLeftIcon, FocusIcon, SendIcon, SparkIcon } from './Icons'
import { Avatar, StatusPill } from './StatusPill'

interface AgentDetailProps {
  agent: Agent
  floorName: string
  events: OfficeEvent[]
  onBack: () => void
  onFocus: () => void
  onDelegate: () => void
  onAssign: () => void
  onEdit: () => void
  onPower: (
    agentId: string,
    action: 'start' | 'stop' | 'restart',
  ) => Promise<void>
}

const BUSY_STATUSES = new Set(['walking', 'delegating', 'coffee', 'offline', 'blocked'])

export function AgentDetail({
  agent,
  floorName,
  events,
  onBack,
  onFocus,
  onDelegate,
  onAssign,
  onEdit,
  onPower,
}: AgentDetailProps) {
  const [powering, setPowering] = useState<'start' | 'stop' | 'restart' | null>(null)
  const task = agent.task
  const canAct = !BUSY_STATUSES.has(agent.status)
  const canDispatch = canAct && (agent.source !== 'docker' || agent.online)
  const related = events
    .filter((event) => event.agentId === agent.id || event.targetId === agent.id)
    .slice(0, 5)

  const power = async (action: 'start' | 'stop' | 'restart') => {
    setPowering(action)
    try {
      await onPower(agent.id, action)
    } finally {
      setPowering(null)
    }
  }

  return (
    <div className="detail">
      <button type="button" className="detail-back" onClick={onBack}>
        <ArrowLeftIcon />
        Ekip
      </button>

      <div className="detail-hero">
        <Avatar agent={agent} size={56} />
        <div className="detail-identity">
          <h2>{agent.name}</h2>
          <p>{agent.role}</p>
        </div>
        <StatusPill status={agent.status} />
      </div>

      <div className="detail-meta">
        <span className="meta-chip">
          KAT {agent.homeFloor} · {floorName}
        </span>
        {agent.floor !== agent.homeFloor && (
          <span className="meta-chip is-visiting">şu an KAT {agent.floor}</span>
        )}
        <span className={`meta-chip ${agent.source === 'hermes' ? 'is-live' : ''}`}>
          {agent.source === 'hermes' ? 'Hermes' : agent.source === 'docker' ? 'Docker' : 'Demo'}
        </span>
        {agent.source === 'docker' && agent.profile && (
          <span className="meta-chip mono">
            {agent.profile} · :{agent.port ?? '—'}
          </span>
        )}
        {agent.model && <span className="meta-chip mono">{agent.model}</span>}
      </div>

      <div className="detail-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onDelegate}
          disabled={!canAct}
          title={canAct ? 'Bu agent adına başka birine iş devret' : 'Agent şu anda masasında değil'}
        >
          <SendIcon />
          İş devret
        </button>
        <button type="button" className="btn btn-secondary" onClick={onAssign} disabled={!canDispatch}>
          <SparkIcon />
          Görev ver
        </button>
        <button type="button" className="btn btn-ghost" onClick={onFocus}>
          <FocusIcon />
          Odağa al
        </button>
      </div>

      {agent.source === 'docker' && (
        <section className="detail-section docker-controls">
          <div className="section-head">
            <h3>Docker profili</h3>
            <span className="section-hint">
              {agent.profile} · :{agent.port ?? '—'}
            </span>
          </div>
          <div className="docker-state-row">
            <span className={`docker-state-pill ${agent.online ? 'up' : 'down'}`}>
              <i />
              {agent.online
                ? 'çalışıyor'
                : agent.dockerState === 'starting'
                  ? 'başlatılıyor'
                  : agent.dockerState === 'stopped'
                    ? 'durduruldu'
                    : 'erişilemiyor'}
            </span>
            <div className="power-buttons">
              <button
                type="button"
                onClick={() => void power('start')}
                disabled={powering !== null || agent.online}
              >
                {powering === 'start' ? '…' : 'Başlat'}
              </button>
              <button
                type="button"
                onClick={() => void power('stop')}
                disabled={powering !== null || !agent.online}
              >
                {powering === 'stop' ? '…' : 'Durdur'}
              </button>
              <button
                type="button"
                onClick={() => void power('restart')}
                disabled={powering !== null}
              >
                {powering === 'restart' ? '…' : 'Yeniden başlat'}
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-secondary edit-profile-btn" onClick={onEdit}>
            ✎ İsim / rol tanımını düzenle
          </button>
        </section>
      )}

      {agent.about && (
        <section className="detail-section">
          <div className="section-head">
            <h3>Görev tanımı</h3>
          </div>
          <p className="about-text">{agent.about}</p>
        </section>
      )}

      <section className="detail-section">
        <div className="section-head">
          <h3>Şu anki görev</h3>
          {task && <span className="section-hint">{elapsedLabel(task.startedAt)}</span>}
        </div>

        {task ? (
          <div className="task-card">
            <div className="task-title-row">
              <strong>{task.title}</strong>
              {task.live && <span className="live-badge"><i /> canlı</span>}
            </div>
            {task.detail && <p className="task-detail">{task.detail}</p>}
            <div className="task-meta">
              <span>{task.assignedBy ? `${task.assignedBy} tarafından` : 'Panel tarafından'}</span>
              {typeof task.progress === 'number' && (
                <span className="task-percent">{Math.round(task.progress)}%</span>
              )}
            </div>
            {typeof task.progress === 'number' ? (
              <div className="task-progress">
                <i style={{ width: `${Math.max(2, task.progress)}%` }} />
              </div>
            ) : (
              <div className="task-progress live">
                <i />
              </div>
            )}
            {agent.activity && (
              <div className="activity-line">
                <span className="activity-dot" />
                şu an: {agent.activity}
              </div>
            )}
          </div>
        ) : (
          <div className="task-card empty">
            <span className="empty-glyph">{agent.status === 'coffee' ? '☕' : '○'}</span>
            <p>
              {agent.status === 'coffee'
                ? 'Kahve molasında.'
                : agent.status === 'offline'
                  ? 'Ofiste değil.'
                  : 'Masa başında, görev bekliyor.'}
            </p>
            {agent.activity && <small>şu an: {agent.activity}</small>}
          </div>
        )}
      </section>

      {agent.queue.length > 0 && (
        <section className="detail-section">
          <div className="section-head">
            <h3>Sırada</h3>
            <span className="section-hint">{agent.queue.length} görev</span>
          </div>
          <ul className="queue-list">
            {agent.queue.map((queued) => (
              <li key={queued.id}>
                <span className="queue-index" />
                <span>{queued.title}</span>
                {queued.assignedBy && <small>{queued.assignedBy}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="detail-section">
          <div className="section-head">
            <h3>Son hareketler</h3>
          </div>
          <ul className="mini-events">
            {related.map((event) => {
              const meta = EVENT_META[event.type]
              return (
                <li key={event.id}>
                  <span className="mini-glyph" style={{ color: meta.color }}>
                    {meta.glyph}
                  </span>
                  <span className="mini-title">{event.title}</span>
                  <span className="mini-time">{relativeTime(event.ts)}</span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="detail-footer">
        <span>Son görülme: {relativeTime(agent.lastActive)}</span>
        {agent.platform && <span>{agent.platform}</span>}
      </div>
    </div>
  )
}
