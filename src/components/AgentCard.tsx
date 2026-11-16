import type { Agent } from '../../shared/types'
import { Avatar, StatusPill } from './StatusPill'

interface AgentCardProps {
  agent: Agent
  selected: boolean
  onClick: () => void
}

export function AgentCard({ agent, selected, onClick }: AgentCardProps) {
  const task = agent.task
  const progress = task?.progress

  return (
    <button
      type="button"
      className={`agent-card ${selected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <Avatar agent={agent} size={38} />
      <span className="agent-card-body">
        <span className="agent-card-top">
          <span className="agent-card-name">{agent.name}</span>
          <StatusPill status={agent.status} compact />
        </span>
        <span className="agent-card-role">
          {agent.role}
          <span className="dot-sep">·</span>K{agent.homeFloor}
          {agent.floor !== agent.homeFloor && (
            <span className="visiting-tag">şu an K{agent.floor}</span>
          )}
        </span>
        <span className={`agent-card-task ${task ? '' : 'muted'}`}>
          {task ? task.title : agent.activity || 'Görev bekliyor'}
        </span>
        {task && typeof progress === 'number' && (
          <span className="mini-progress">
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
        {task && progress === null && (
          <span className="mini-progress live">
            <i />
          </span>
        )}
      </span>
      {agent.queue.length > 0 && (
        <span className="queue-badge" title={`${agent.queue.length} görev sırada`}>
          +{agent.queue.length}
        </span>
      )}
    </button>
  )
}
