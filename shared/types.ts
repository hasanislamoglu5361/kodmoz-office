export type AgentStatus =
  | 'idle'
  | 'working'
  | 'walking'
  | 'delegating'
  | 'coffee'
  | 'blocked'
  | 'offline'

export type AgentSource = 'demo' | 'docker' | 'hermes' | 'manual'

export type DockerAgentState = 'running' | 'stopped' | 'starting' | 'error' | 'unknown'

export interface DockerStatus {
  enabled: boolean
  container: string
  running: boolean
  online: number
  total: number
}

export type EventType =
  | 'task_started'
  | 'task_done'
  | 'delegation'
  | 'handoff'
  | 'status'
  | 'session'
  | 'tool'
  | 'system'

export interface Point {
  x: number
  y: number
}

export interface Desk {
  id: string
  floor: number
  /** floor-local top-left */
  x: number
  y: number
  row: 'top' | 'bottom'
  seat: Point
  visit: Point
  agentId: string | null
}

export interface Floor {
  number: number
  name: string
  subtitle: string
  /** global y of the floor's top edge */
  top: number
  desks: Desk[]
  coffee: Point
  lounge: Point
  elevator: {
    wait: Point
    cab: Point
  }
}

export interface ElevatorShaft {
  x: number
  y: number
  width: number
  height: number
  centerX: number
}

export interface OfficeLayout {
  width: number
  height: number
  floorHeight: number
  floorGap: number
  floors: Floor[]
  shaft: ElevatorShaft
}

export interface Task {
  id: string
  title: string
  detail?: string
  assignedBy?: string
  startedAt: number
  /** null when the source cannot report progress (live Hermes agent) */
  progress: number | null
  live?: boolean
}

export interface Bubble {
  text: string
  kind: 'speech' | 'thought'
  until: number
}

export interface Agent {
  id: string
  name: string
  role: string
  floor: number
  homeFloor: number
  deskId: string
  color: string
  initials: string
  status: AgentStatus
  source: AgentSource
  model?: string
  platform?: string
  profile?: string
  port?: number
  dockerState?: DockerAgentState
  about?: string
  task: Task | null
  queue: Task[]
  /** global building coordinates */
  x: number
  y: number
  facing: -1 | 0 | 1
  inElevator: boolean
  bubble: Bubble | null
  /** short "currently doing" line for live agents, e.g. "write_file" */
  activity?: string
  lastActive: number
  online: boolean
}

export interface ElevatorState {
  floor: number
  cabY: number
  moving: boolean
  riderId: string | null
  queue: string[]
}

export interface OfficeEvent {
  id: string
  ts: number
  type: EventType
  agentId?: string
  targetId?: string
  title: string
  detail?: string
}

export interface SimulatorState {
  demo: boolean
  running: boolean
  speed: number
}

export interface Snapshot {
  now: number
  layout: OfficeLayout
  agents: Agent[]
  elevator: ElevatorState
  simulator: SimulatorState
  docker: DockerStatus
  events: OfficeEvent[]
  version: number
}

export type ServerMessage =
  | { type: 'snapshot'; state: Snapshot }
  | {
      type: 'tick'
      agents: Agent[]
      elevator: ElevatorState
      simulator: SimulatorState
      docker: DockerStatus
      now: number
    }
  | { type: 'event'; event: OfficeEvent }
  | { type: 'simulator'; simulator: SimulatorState }
  | { type: 'error'; message: string }

export interface HermesEvent {
  type:
    | 'session_start'
    | 'session_end'
    | 'session_finalize'
    | 'tool_start'
    | 'tool_end'
    | 'llm_start'
    | 'llm_end'
    | 'subagent_start'
    | 'subagent_stop'
  agentId?: string
  sessionId?: string
  parentSessionId?: string
  childSessionId?: string
  agentName?: string
  role?: string
  model?: string
  platform?: string
  toolName?: string
  taskTitle?: string
  activity?: string
  childRole?: string
  status?: string
  detail?: string
}
