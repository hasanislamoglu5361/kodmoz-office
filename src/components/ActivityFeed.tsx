import { useMemo, useState } from 'react'
import type { Agent, OfficeEvent } from '../../shared/types'
import { EVENT_META, relativeTime } from '../lib/status'

interface ActivityFeedProps {
  events: OfficeEvent[]
  agents: Agent[]
  onSelectAgent: (agentId: string) => void
}

type Filter = 'all' | 'task' | 'handoff' | 'system'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'task', label: 'Görev' },
  { id: 'handoff', label: 'Devir' },
  { id: 'system', label: 'Sistem' },
]

function matches(event: OfficeEvent, filter: Filter): boolean {
  if (filter === 'all') return true
  if (filter === 'task') return event.type === 'task_started' || event.type === 'task_done'
  if (filter === 'handoff') return event.type === 'delegation' || event.type === 'handoff'
  return event.type === 'session' || event.type === 'status' || event.type === 'system'
}

export function ActivityFeed({ events, agents, onSelectAgent }: ActivityFeedProps) {
  const [filter, setFilter] = useState<Filter>('all')

  const byId = useMemo(() => {
    const map = new Map<string, Agent>()
    for (const agent of agents) map.set(agent.id, agent)
    return map
  }, [agents])

  const visible = useMemo(
    () => events.filter((event) => matches(event, filter)).slice(0, 80),
    [events, filter],
  )

  return (
    <div className="feed">
      <div className="feed-filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? 'active' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="empty-state">
          <span className="empty-glyph">◇</span>
          <p>Henüz bir hareket yok.</p>
          <small>Görevler ve devirler burada canlı olarak akar.</small>
        </div>
      )}

      <div className="feed-list">
        {visible.map((event) => {
          const meta = EVENT_META[event.type]
          const agent = event.agentId ? byId.get(event.agentId) : undefined
          const target = event.targetId ? byId.get(event.targetId) : undefined

          return (
            <div key={event.id} className={`feed-item feed-${event.type}`}>
              <span className="feed-icon" style={{ color: meta.color, borderColor: `${meta.color}33` }}>
                {meta.glyph}
              </span>
              <span className="feed-body">
                <span className="feed-line">
                  {event.type === 'delegation' && agent && target ? (
                    <>
                      <button type="button" onClick={() => onSelectAgent(agent.id)}>
                        {agent.name}
                      </button>
                      <span className="feed-arrow">→</span>
                      <button type="button" onClick={() => onSelectAgent(target.id)}>
                        {target.name}
                      </button>
                    </>
                  ) : event.type === 'handoff' && agent && target ? (
                    <>
                      <button type="button" onClick={() => onSelectAgent(agent.id)}>
                        {agent.name}
                      </button>
                      <span className="feed-arrow">⇄</span>
                      <button type="button" onClick={() => onSelectAgent(target.id)}>
                        {target.name}
                      </button>
                    </>
                  ) : agent ? (
                    <button type="button" onClick={() => onSelectAgent(agent.id)}>
                      {agent.name}
                    </button>
                  ) : (
                    <span className="feed-system">{meta.label}</span>
                  )}
                  <span className="feed-what">
                    {event.type === 'delegation'
                      ? 'iş devretti'
                      : event.type === 'handoff'
                        ? 'işi devraldı'
                        : event.type === 'task_started'
                          ? 'başladı'
                          : event.type === 'task_done'
                            ? 'tamamladı'
                            : ''}
                  </span>
                </span>
                <span className="feed-title">{event.title}</span>
                {event.detail && event.type === 'system' && (
                  <span className="feed-detail">{event.detail}</span>
                )}
              </span>
              <span className="feed-time">{relativeTime(event.ts)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
