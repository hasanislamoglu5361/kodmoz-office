import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Agent,
  DockerStatus,
  ElevatorState,
  OfficeEvent,
  ServerMessage,
  SimulatorState,
  Snapshot,
} from '../../shared/types'

export type ConnectionState = 'connecting' | 'live' | 'offline' | 'unauthorized'

const EMPTY_ELEVATOR: ElevatorState = {
  floor: 1,
  cabY: 0,
  moving: false,
  riderId: null,
  queue: [],
}

const EMPTY_SIMULATOR: SimulatorState = { demo: true, running: true, speed: 1 }
const EMPTY_DOCKER: DockerStatus = {
  enabled: false,
  container: '',
  running: false,
  online: 0,
  total: 0,
}

export function useOffice(token: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [elevator, setElevator] = useState<ElevatorState>(EMPTY_ELEVATOR)
  const [simulator, setSimulator] = useState<SimulatorState>(EMPTY_SIMULATOR)
  const [docker, setDocker] = useState<DockerStatus>(EMPTY_DOCKER)
  const [events, setEvents] = useState<OfficeEvent[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [attempt, setAttempt] = useState(0)
  const retryRef = useRef(0)

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let retryTimer: number | undefined

    const connect = () => {
      if (disposed) return
      setConnection((previous) => (previous === 'unauthorized' ? previous : 'connecting'))

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      socket = new WebSocket(`${protocol}//${window.location.host}/ws${query}`)

      socket.onopen = () => {
        retryRef.current = 0
        setConnection('live')
      }

      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as ServerMessage
          if (payload.type === 'snapshot') {
            setSnapshot(payload.state)
            setAgents(payload.state.agents)
            setElevator(payload.state.elevator)
            setSimulator(payload.state.simulator)
            setDocker(payload.state.docker)
            setEvents(payload.state.events)
          } else if (payload.type === 'tick') {
            setAgents(payload.agents)
            setElevator(payload.elevator)
            setSimulator(payload.simulator)
            setDocker(payload.docker)
          } else if (payload.type === 'event') {
            setEvents((previous) => {
              if (previous.some((event) => event.id === payload.event.id)) return previous
              return [payload.event, ...previous].slice(0, 90)
            })
          } else if (payload.type === 'simulator') {
            setSimulator(payload.simulator)
          }
        } catch {
          // ignore malformed frames
        }
      }

      socket.onclose = (event) => {
        if (disposed) return
        if (event.code === 4401) {
          setConnection('unauthorized')
          return
        }
        setConnection('offline')
        const delay = Math.min(9000, 1200 * 2 ** retryRef.current)
        retryRef.current += 1
        retryTimer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      socket?.close()
    }
  }, [token, attempt])

  const reconnect = useCallback(() => setAttempt((value) => value + 1), [])

  return { snapshot, agents, elevator, simulator, docker, events, connection, reconnect }
}
