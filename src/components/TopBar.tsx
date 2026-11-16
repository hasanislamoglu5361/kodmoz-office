import { useEffect, useState } from 'react'
import type { Agent, DockerStatus, Floor, SimulatorState } from '../../shared/types'
import type { ConnectionState } from '../hooks/useOffice'
import { clockLabel } from '../lib/status'
import { BrandMark } from './BrandMark'
import {
  FitIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
} from './Icons'

interface TopBarProps {
  agents: Agent[]
  floors: Floor[]
  connection: ConnectionState
  simulator: SimulatorState
  docker: DockerStatus
  onToggleRunning: () => void
  onCycleSpeed: () => void
  onToggleDemo: () => void
  onFit: () => void
  onSelectFloor: (floor: number) => void
  onOpenPanel: () => void
}

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  live: 'Canlı',
  connecting: 'Bağlanıyor',
  offline: 'Bağlantı yok',
  unauthorized: 'Kilitli',
}

export function TopBar({
  agents,
  floors,
  connection,
  simulator,
  docker,
  onToggleRunning,
  onCycleSpeed,
  onToggleDemo,
  onFit,
  onSelectFloor,
  onOpenPanel,
}: TopBarProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const working = agents.filter((agent) => agent.status === 'working').length
  const hermes = agents.filter(
    (agent) => agent.source === 'hermes' && agent.online,
  ).length

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <BrandMark size={34} />
          <div className="brand-text">
            <span className="brand-name">KODMOZ OFİS</span>
            <span className="brand-sub">hermes agent katı</span>
          </div>
        </div>

        <div className="topbar-center">
          <span className={`connection conn-${connection}`}>
            <i />
            {CONNECTION_LABEL[connection]}
          </span>
          {docker.enabled && (
            <span
              className={`docker-chip ${docker.running ? 'is-up' : 'is-down'}`}
              title={`Docker konteyneri: ${docker.container}`}
            >
              <i />
              Docker
              <b>
                {docker.online}/{docker.total}
              </b>
            </span>
          )}
          <span className="topbar-stat">
            <strong>{agents.length}</strong> ajan
            <span className="dot-sep">·</span>
            <strong>{working}</strong> çalışıyor
            {hermes > 0 && (
              <>
                <span className="dot-sep">·</span>
                <strong>{hermes}</strong> canlı
              </>
            )}
          </span>
          <div className="floor-chips" aria-label="Katlar">
            {floors.map((floor) => {
              const onFloor = agents.filter((agent) => agent.floor === floor.number)
              const occupied = floor.desks.filter((desk) => desk.agentId).length
              return (
                <button
                  key={floor.number}
                  type="button"
                  className="floor-chip"
                  title={`Kat ${floor.number} — ${floor.name}`}
                  onClick={() => onSelectFloor(floor.number)}
                >
                  <b>K{floor.number}</b>
                  <span>
                    {occupied}/{floor.desks.length}
                  </span>
                  {onFloor.some((agent) => agent.status === 'working') && <i />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="topbar-right">
          <span className="clock">{clockLabel(now)}</span>
          {!docker.enabled && (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={onToggleRunning}
                title={simulator.running ? 'Simülasyonu duraklat' : 'Simülasyonu sürdür'}
                aria-label={simulator.running ? 'Duraklat' : 'Sürdür'}
              >
                {simulator.running ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                type="button"
                className="speed-btn"
                onClick={onCycleSpeed}
                title="Simülasyon hızı"
              >
                {simulator.speed}×
              </button>
              <button
                type="button"
                className={`demo-btn ${simulator.demo ? 'is-on' : ''}`}
                onClick={onToggleDemo}
                title={simulator.demo ? 'Demo simülasyonunu kapat' : 'Demo simülasyonunu aç'}
              >
                <i />
                Demo
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={onFit}
            title="Tüm binayı sığdır"
            aria-label="Tüm binayı sığdır"
          >
            <FitIcon />
          </button>
          <button
            type="button"
            className="icon-btn panel-toggle"
            onClick={onOpenPanel}
            title="Ekibi aç"
            aria-label="Ekibi aç"
          >
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="mobile-floorbar">
        {floors.map((floor) => (
          <button
            key={floor.number}
            type="button"
            onClick={() => onSelectFloor(floor.number)}
          >
            <b>K{floor.number}</b>
            <span>{floor.name}</span>
          </button>
        ))}
        <button type="button" className="mobile-fit" onClick={onFit}>
          Tüm bina
        </button>
      </div>
    </>
  )
}
