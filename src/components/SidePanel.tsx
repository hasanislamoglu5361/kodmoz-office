import type {
  Agent,
  DockerStatus,
  Floor,
  OfficeEvent,
  SimulatorState,
} from '../../shared/types'
import type { ConnectionState } from '../hooks/useOffice'
import { ActivityFeed } from './ActivityFeed'
import { AgentCard } from './AgentCard'
import { AgentDetail } from './AgentDetail'
import { CloseIcon } from './Icons'

export type PanelTab = 'team' | 'activity'

interface SidePanelProps {
  agents: Agent[]
  events: OfficeEvent[]
  floors: Floor[]
  selectedAgent: Agent | null
  tab: PanelTab
  mobileOpen: boolean
  connection: ConnectionState
  simulator: SimulatorState
  docker: DockerStatus
  onTabChange: (tab: PanelTab) => void
  onSelectAgent: (agentId: string) => void
  onClearSelection: () => void
  onFocusAgent: (agentId: string) => void
  onOpenTask: (agentId: string) => void
  onOpenDelegate: (agentId: string) => void
  onOpenEdit: (agentId: string) => void
  onPower: (
    agentId: string,
    action: 'start' | 'stop' | 'restart',
  ) => Promise<void>
  onDockerAction: (action: 'start' | 'stop' | 'restart') => void
  onClosePanel: () => void
}

export function SidePanel({
  agents,
  events,
  floors,
  selectedAgent,
  tab,
  mobileOpen,
  connection,
  simulator,
  docker,
  onTabChange,
  onSelectAgent,
  onClearSelection,
  onFocusAgent,
  onOpenTask,
  onOpenDelegate,
  onOpenEdit,
  onPower,
  onDockerAction,
  onClosePanel,
}: SidePanelProps) {
  const working = agents.filter((agent) => agent.status === 'working').length
  const idle = agents.filter((agent) => agent.status === 'idle').length
  const moving = agents.filter(
    (agent) => agent.status === 'delegating' || agent.status === 'walking',
  ).length
  const hermesCount = agents.filter(
    (agent) => agent.source === 'hermes' && agent.online,
  ).length
  const liveCount = hermesCount + docker.online
  const footerText = docker.enabled
    ? docker.running
      ? `${docker.online}/${docker.total} Docker agentı çevrimiçi`
      : 'Docker konteyneri kapalı'
    : hermesCount > 0
      ? `${hermesCount} canlı Hermes oturumu`
      : simulator.demo
        ? 'Demo modu · Hermes köprüsü bekleniyor'
        : 'Simülasyon kapalı'

  const sortedFloors = [...floors].sort((a, b) => b.number - a.number)
  const selectedHomeFloor = selectedAgent?.homeFloor ?? 0
  const floorName = selectedAgent
    ? floors.find((floor) => floor.number === selectedHomeFloor)?.name ?? ''
    : ''

  return (
    <aside className={`panel ${mobileOpen ? 'is-open' : ''}`}>
      <div className="panel-header">
        <div className="panel-tabs">
          <button
            type="button"
            className={tab === 'team' ? 'active' : ''}
            onClick={() => onTabChange('team')}
          >
            Ekip <span>{agents.length}</span>
          </button>
          <button
            type="button"
            className={tab === 'activity' ? 'active' : ''}
            onClick={() => onTabChange('activity')}
          >
            Akış <span>{events.length}</span>
          </button>
        </div>
        <button
          type="button"
          className="panel-close"
          onClick={onClosePanel}
          aria-label="Paneli kapat"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="panel-body">
        {tab === 'team' && selectedAgent ? (
          <AgentDetail
            agent={selectedAgent}
            floorName={floorName}
            events={events}
            onBack={onClearSelection}
            onFocus={() => onFocusAgent(selectedAgent.id)}
            onDelegate={() => onOpenDelegate(selectedAgent.id)}
            onAssign={() => onOpenTask(selectedAgent.id)}
            onEdit={() => onOpenEdit(selectedAgent.id)}
            onPower={onPower}
          />
        ) : tab === 'team' ? (
          <div className="team">
            <div className="team-summary">
              <div className="summary-cell">
                <span className="summary-value" style={{ color: '#7bd8b0' }}>{working}</span>
                <span className="summary-label">çalışıyor</span>
              </div>
              <div className="summary-cell">
                <span className="summary-value" style={{ color: '#98a0aa' }}>{idle}</span>
                <span className="summary-label">boşta</span>
              </div>
              <div className="summary-cell">
                <span className="summary-value" style={{ color: '#e8b45a' }}>{moving}</span>
                <span className="summary-label">yolda</span>
              </div>
            </div>

            {sortedFloors.map((floor) => {
              const onFloor = floor.desks
                .map((desk) => agents.find((agent) => agent.deskId === desk.id))
                .filter((agent): agent is Agent => Boolean(agent))
              if (onFloor.length === 0) return null
              const occupied = floor.desks.filter((desk) => desk.agentId).length

              return (
                <div className="team-group" key={floor.number}>
                  <div className="team-group-head">
                    <span>
                      KAT {floor.number} <b>{floor.name}</b>
                    </span>
                    <span className="team-group-count">
                      {occupied}/{floor.desks.length}
                    </span>
                  </div>
                  {onFloor.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      selected={selectedAgent?.id === agent.id}
                      onClick={() => onSelectAgent(agent.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <ActivityFeed
            events={events}
            agents={agents}
            onSelectAgent={(agentId) => {
              onSelectAgent(agentId)
              onTabChange('team')
            }}
          />
        )}
      </div>

      <div className="panel-footer">
        <span className={`footer-dot ${liveCount > 0 ? 'is-live' : ''}`} />
        <span className="footer-text">{footerText}</span>
        {docker.enabled && (
          <button
            type="button"
            className={`docker-footer ${docker.running ? 'is-up' : 'is-down'}`}
            onClick={() => onDockerAction(docker.running ? 'stop' : 'start')}
            title={docker.running ? 'Docker konteynerini durdur' : 'Docker konteynerini başlat'}
          >
            <i />
            Docker {docker.running ? `${docker.online}/${docker.total}` : 'kapalı'}
          </button>
        )}
        <span className={`footer-connection ${connection}`}>
          {connection === 'live' ? 'bağlı' : connection === 'offline' ? 'çevrimdışı' : '...'}
        </span>
      </div>
    </aside>
  )
}
