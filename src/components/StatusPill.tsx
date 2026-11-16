import type { CSSProperties } from 'react'
import type { Agent, AgentStatus } from '../../shared/types'
import { STATUS_META } from '../lib/status'
import { foregroundFor } from '../lib/color'

export function StatusPill({
  status,
  compact = false,
}: {
  status: AgentStatus
  compact?: boolean
}) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`status-pill ${compact ? 'compact' : ''}`}
      style={{ '--status-color': meta.color, '--status-soft': meta.soft } as CSSProperties}
    >
      <i />
      {meta.label}
    </span>
  )
}

export function Avatar({
  agent,
  size = 38,
}: {
  agent: Pick<Agent, 'initials' | 'color' | 'status' | 'name'>
  size?: number
}) {
  const meta = STATUS_META[agent.status]
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, ${agent.color}, ${agent.color}cc)`,
        color: foregroundFor(agent.color),
        fontSize: Math.max(10, size * 0.33),
      }}
      aria-label={`${agent.name} — ${meta.label}`}
    >
      {agent.initials}
      <span className="avatar-status" style={{ background: meta.color }} />
    </span>
  )
}
