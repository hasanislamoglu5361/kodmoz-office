import { useCallback, useRef, useState } from 'react'
import type { Agent } from '../shared/types'
import {
  assignTask,
  delegateWork,
  dockerContainer,
  getToken,
  powerAgent,
  setToken as persistToken,
  updateAgentProfile,
  updateSimulator,
} from './api'
import { useOffice } from './hooks/useOffice'
import type { ConnectionState } from './hooks/useOffice'
import { OfficeCanvas } from './scene/OfficeCanvas'
import type { OfficeCanvasHandle } from './scene/OfficeCanvas'
import { TopBar } from './components/TopBar'
import { SidePanel } from './components/SidePanel'
import type { PanelTab } from './components/SidePanel'
import { AssignDialog } from './components/AssignDialog'
import { EditAgentDialog } from './components/EditAgentDialog'
import { TokenGate } from './components/TokenGate'
import { Toasts } from './components/Toasts'
import type { ToastItem } from './components/Toasts'
import { BrandMark } from './components/BrandMark'
import { ArrowRightIcon } from './components/Icons'

interface DialogState {
  mode: 'task' | 'delegate' | 'edit'
  agentId: string
}

function BootScreen({
  connection,
  onRetry,
}: {
  connection: ConnectionState
  onRetry: () => void
}) {
  const offline = connection === 'offline'
  return (
    <div className="boot">
      <div className="boot-floors" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="boot-content">
        <BrandMark size={52} />
        <span className="boot-kicker">KODMOZ OFİS</span>
        <h1>{offline ? 'Sunucuya ulaşılamıyor' : 'Ofis hazırlanıyor'}</h1>
        <p>
          {offline
            ? 'Sunucunun çalıştığından emin ol. Yeniden denemek için aşağıdaki butonu kullan.'
            : 'Agentlar masalarına yerleşiyor, ışıklar yanıyor.'}
        </p>
        {offline ? (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            Yeniden dene
            <ArrowRightIcon />
          </button>
        ) : (
          <span className="boot-loader">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const [token, setTokenState] = useState(() => getToken())
  const {
    snapshot,
    agents,
    elevator,
    simulator,
    docker,
    events,
    connection,
    reconnect,
  } = useOffice(token)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('team')
  const [mobilePanel, setMobilePanel] = useState(false)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(1)
  const canvasRef = useRef<OfficeCanvasHandle>(null)

  const notify = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = toastId.current
    toastId.current += 1
    setToasts((previous) => [...previous.slice(-3), { id, message, tone }])
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id))
    }, 4800)
  }, [])

  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'İşlem tamamlanamadı.'

  const handleToken = (value: string) => {
    persistToken(value)
    setTokenState(value)
    reconnect()
  }

  const selectFromCanvas = (agentId: string | null) => {
    setSelectedId(agentId)
    if (agentId) {
      setTab('team')
      if (window.innerWidth <= 900) setMobilePanel(true)
    }
  }

  const selectFromPanel = (agentId: string) => {
    setSelectedId(agentId)
    setTab('team')
    window.requestAnimationFrame(() => canvasRef.current?.focusAgent(agentId))
  }

  const selectedAgent = selectedId
    ? agents.find((agent) => agent.id === selectedId) ?? null
    : null

  const dialogAgent: Agent | null = dialog
    ? agents.find((agent) => agent.id === dialog.agentId) ?? null
    : null

  const handleTaskSubmit = async ({
    title,
    detail,
  }: {
    title: string
    detail: string
  }) => {
    if (!dialogAgent) return
    const result = await assignTask(dialogAgent.id, title, detail)
    notify(
      result.queued
        ? `${dialogAgent.name} için görev sıraya alındı.`
        : `${dialogAgent.name} yeni göreve başladı.`,
      'ok',
    )
  }

  const handleDelegateSubmit = async ({
    title,
    detail,
    targetId,
  }: {
    title: string
    detail: string
    targetId?: string
  }) => {
    if (!dialogAgent || !targetId) return
    const target = agents.find((agent) => agent.id === targetId)
    await delegateWork(dialogAgent.id, targetId, title, detail)
    notify(
      `${dialogAgent.name}, ${target?.name ?? 'hedef agent'} masasına doğru yola çıktı.`,
      'ok',
    )
  }

  const handleEditSubmit = async (patch: {
    name: string
    role: string
    about: string
  }) => {
    if (!dialogAgent) return
    await updateAgentProfile(dialogAgent.id, patch)
    notify(
      dialogAgent.source === 'docker'
        ? `${patch.name} profili güncellendi; Docker gateway’i yeniden başlatılıyor.`
        : `${patch.name} profili güncellendi.`,
      'ok',
    )
  }

  const handlePower = async (
    agentId: string,
    action: 'start' | 'stop' | 'restart',
  ) => {
    const agent = agents.find((candidate) => candidate.id === agentId)
    try {
      await powerAgent(agentId, action)
      notify(
        action === 'stop'
          ? `${agent?.name ?? 'Agent'} durduruldu.`
          : action === 'start'
            ? `${agent?.name ?? 'Agent'} başlatılıyor.`
            : `${agent?.name ?? 'Agent'} yeniden başlatılıyor.`,
        'ok',
      )
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const handleDockerAction = async (action: 'start' | 'stop' | 'restart') => {
    if (action === 'stop') {
      const confirmed = window.confirm(
        'Docker konteyneri durdurulsun mu? Tüm agentlar çevrimdışı olur.',
      )
      if (!confirmed) return
    }
    try {
      await dockerContainer(action)
      notify(
        action === 'stop'
          ? 'Docker konteyneri durduruldu.'
          : action === 'start'
            ? 'Docker konteyneri başlatılıyor.'
            : 'Docker konteyneri yeniden başlatılıyor.',
        'ok',
      )
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const runSimulator = async (patch: Parameters<typeof updateSimulator>[0]) => {
    try {
      await updateSimulator(patch)
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const cycleSpeed = () => {
    const next = simulator.speed >= 4 ? 1 : simulator.speed * 2
    void runSimulator({ speed: next })
  }

  if (connection === 'unauthorized') {
    return (
      <>
        <TokenGate onSubmit={handleToken} />
        <Toasts items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      </>
    )
  }

  if (!snapshot) {
    return (
      <BootScreen
        connection={connection}
        onRetry={() => {
          if (connection === 'offline') {
            notify('Yeniden bağlanılıyor…', 'info')
          }
          reconnect()
        }}
      />
    )
  }

  return (
    <div className="app">
      <TopBar
        agents={agents}
        floors={snapshot.layout.floors}
        connection={connection}
        simulator={simulator}
        docker={docker}
        onToggleRunning={() => void runSimulator({ running: !simulator.running })}
        onCycleSpeed={cycleSpeed}
        onToggleDemo={() => void runSimulator({ demo: !simulator.demo })}
        onFit={() => canvasRef.current?.fit()}
        onSelectFloor={(floor) => canvasRef.current?.focusFloor(floor)}
        onOpenPanel={() => setMobilePanel(true)}
      />

      <main className="workspace">
        <section className="scene-shell">
          <OfficeCanvas
            ref={canvasRef}
            layout={snapshot.layout}
            agents={agents}
            elevator={elevator}
            selectedId={selectedId}
            onSelectAgent={selectFromCanvas}
            onSelectFloor={(floor) => canvasRef.current?.focusFloor(floor)}
          />
          {connection === 'offline' && (
            <div className="offline-banner">
              <i />
              Bağlantı koptu — yeniden bağlanılıyor…
            </div>
          )}
        </section>

        <div
          className={`panel-backdrop ${mobilePanel ? 'is-visible' : ''}`}
          onClick={() => setMobilePanel(false)}
        />

        <SidePanel
          agents={agents}
          events={events}
          floors={snapshot.layout.floors}
          selectedAgent={selectedAgent}
          tab={tab}
          mobileOpen={mobilePanel}
          connection={connection}
          simulator={simulator}
          docker={docker}
          onTabChange={setTab}
          onSelectAgent={selectFromPanel}
          onClearSelection={() => setSelectedId(null)}
          onFocusAgent={(agentId) => canvasRef.current?.focusAgent(agentId)}
          onOpenTask={(agentId) => setDialog({ mode: 'task', agentId })}
          onOpenDelegate={(agentId) => setDialog({ mode: 'delegate', agentId })}
          onOpenEdit={(agentId) => setDialog({ mode: 'edit', agentId })}
          onPower={handlePower}
          onDockerAction={(action) => void handleDockerAction(action)}
          onClosePanel={() => setMobilePanel(false)}
        />
      </main>

      {dialog && dialogAgent && dialog.mode === 'edit' && (
        <EditAgentDialog
          agent={dialogAgent}
          onClose={() => setDialog(null)}
          onSubmit={handleEditSubmit}
        />
      )}

      {dialog && dialogAgent && dialog.mode !== 'edit' && (
        <AssignDialog
          mode={dialog.mode}
          source={dialogAgent}
          agents={agents}
          onClose={() => setDialog(null)}
          onSubmit={dialog.mode === 'delegate' ? handleDelegateSubmit : handleTaskSubmit}
        />
      )}

      <Toasts
        items={toasts}
        onDismiss={(id) => setToasts((previous) => previous.filter((toast) => toast.id !== id))}
      />
    </div>
  )
}
