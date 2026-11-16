import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type {
  Agent,
  AgentSource,
  AgentStatus,
  Bubble,
  Desk,
  DockerAgentState,
  DockerStatus,
  ElevatorState,
  OfficeEvent,
  OfficeLayout,
  Point,
  SimulatorState,
  Snapshot,
  Task,
} from '../shared/types'
import { config, ROOT } from './config'
import {
  COFFEE_POINT,
  CORRIDOR_Y,
  ELEVATOR_CAB,
  ELEVATOR_WAIT,
  buildLayout,
  slotOrder,
  type FloorDefinition,
} from './layout'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface SeedAgent {
  id: string
  name: string
  role: string
  description?: string
  floor: number
  slot: number
  color: string
  model?: string
  profile?: string
  port?: number
}

interface AgentOverride {
  name?: string
  role?: string
  about?: string
}

interface SeedFile {
  floors: FloorDefinition[]
  agents: SeedAgent[]
}

export interface ProvisionInput {
  sessionId: string
  name?: string
  role?: string
  model?: string
  platform?: string
}

type Step =
  | { kind: 'walk'; x: number; y: number }
  | { kind: 'elevator'; toFloor: number }
  | { kind: 'wait'; ms: number }
  | { kind: 'action'; action: TripAction }

type TripAction = 'handoff' | 'return' | 'coffeeDone' | 'tripDone'

interface Trip {
  kind: 'delegation' | 'coffee'
  phase: 'out' | 'back'
  targetId?: string
  task?: Task
}

export interface RuntimeAgent extends Agent {
  home: Point
  homeFloor: number
  steps: Step[]
  stepIndex: number
  stepStartedAt: number
  trip: Trip | null
  awaitingElevator: boolean
  nextIdleAt: number
  nextCoffeeAt: number
  taskRate: number
}

const FALLBACK_SEED: SeedFile = {
  floors: [
    { number: 3, name: 'Strateji', subtitle: 'planlama · araştırma' },
    { number: 2, name: 'Üretim', subtitle: 'kod · tasarım · veri' },
    { number: 1, name: 'Operasyon', subtitle: 'içerik · altyapı · kalite' },
  ],
  agents: [
    { id: 'atlas', name: 'Atlas', role: 'Orkestratör', floor: 3, slot: 0, color: '#e8b45a' },
    { id: 'ada', name: 'Ada', role: 'Araştırma', floor: 3, slot: 3, color: '#6fb3ff' },
    { id: 'deniz', name: 'Deniz', role: 'Ürün', floor: 3, slot: 1, color: '#7dd3c7' },
    { id: 'bora', name: 'Bora', role: 'Yazılım', floor: 2, slot: 0, color: '#f08a5d' },
    { id: 'ece', name: 'Ece', role: 'Tasarım', floor: 2, slot: 3, color: '#c79bff' },
    { id: 'kerem', name: 'Kerem', role: 'Veri', floor: 2, slot: 1, color: '#7dd3fc' },
    { id: 'lale', name: 'Lale', role: 'İçerik', floor: 1, slot: 0, color: '#f472b6' },
    { id: 'mert', name: 'Mert', role: 'DevOps', floor: 1, slot: 3, color: '#94a3b8' },
    { id: 'zeynep', name: 'Zeynep', role: 'Kalite', floor: 1, slot: 1, color: '#a3e635' },
  ],
}

const AUTO_COLORS = [
  '#6fb3ff',
  '#f08a5d',
  '#7dd3c7',
  '#c79bff',
  '#e8b45a',
  '#f472b6',
  '#7dd3fc',
  '#a3e635',
  '#fca5a5',
  '#93c5fd',
]

function loadSeed(): SeedFile {
  const custom = process.env.OFFICE_DATA
  const candidates = custom
    ? [path.resolve(custom)]
    : [path.join(process.cwd(), 'data', 'office.json'), path.join(__dirname, '..', 'data', 'office.json')]

  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SeedFile
      if (Array.isArray(parsed.floors) && Array.isArray(parsed.agents)) return parsed
    } catch {
      // try next candidate
    }
  }
  return FALLBACK_SEED
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toLocaleUpperCase('tr-TR')
  }
  return name.slice(0, 2).toLocaleUpperCase('tr-TR')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function shortId(sessionId: string): string {
  return createHash('sha1').update(sessionId).digest('hex').slice(0, 8)
}

function cloneTask(task: Task | null): Task | null {
  return task ? { ...task } : null
}

export class OfficeStore {
  readonly layout: OfficeLayout
  readonly simulator: SimulatorState = { demo: true, running: true, speed: 1 }
  readonly docker: DockerStatus = {
    enabled: config.docker.enabled,
    container: config.docker.container,
    running: false,
    online: 0,
    total: 0,
  }

  onEvent: ((event: OfficeEvent) => void) | null = null
  onSimulator: ((simulator: SimulatorState) => void) | null = null
  onTaskStarted: ((agent: RuntimeAgent, task: Task) => void) | null = null

  private readonly agents = new Map<string, RuntimeAgent>()
  private readonly sessionMap = new Map<string, string>()
  private readonly events: OfficeEvent[] = []
  private readonly seed: SeedFile
  private readonly overridesPath = path.resolve(
    process.env.OFFICE_OVERRIDES || path.join(ROOT, 'data', 'agent-overrides.json'),
  )
  private overrides: Record<string, AgentOverride> = {}

  private elevatorFloor = 1
  private elevatorY = 0
  private elevatorMoving = false
  private elevatorRider: { agentId: string; toFloor: number } | null = null
  private elevatorQueue: { agentId: string; from: number; to: number }[] = []
  private elevatorBoardingUntil = 0

  private now = Date.now()

  constructor() {
    this.seed = loadSeed()
    this.layout = buildLayout(this.seed.floors)
    this.elevatorFloor = this.lowestFloor
    this.elevatorY = this.floorTop(this.elevatorFloor) + ELEVATOR_WAIT.y
    this.loadOverrides()
    this.seedAgents()
    this.applyOverrides()
    this.seedScenario()
    if (config.docker.enabled) this.simulator.demo = false
    this.updateDockerTotals()
  }

  get lowestFloor(): number {
    return this.layout.floors[this.layout.floors.length - 1]?.number ?? 1
  }

  floorTop(floorNumber: number): number {
    return this.layout.floors.find((floor) => floor.number === floorNumber)?.top ?? 0
  }

  private floor(floorNumber: number) {
    return this.layout.floors.find((candidate) => candidate.number === floorNumber)
  }

  runtimeAgents(): RuntimeAgent[] {
    return [...this.agents.values()]
  }

  getAgent(id: string): RuntimeAgent | undefined {
    return this.agents.get(id)
  }

  findBySession(sessionId: string): RuntimeAgent | undefined {
    const id = this.sessionMap.get(sessionId)
    return id ? this.agents.get(id) : undefined
  }

  linkSession(sessionId: string, agentId: string): void {
    if (sessionId && this.agents.has(agentId)) this.sessionMap.set(sessionId, agentId)
  }

  private loadOverrides(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.overridesPath, 'utf8')) as Record<
        string,
        AgentOverride
      >
      if (parsed && typeof parsed === 'object') this.overrides = parsed
    } catch {
      this.overrides = {}
    }
  }

  private applyOverrides(): void {
    for (const [agentId, override] of Object.entries(this.overrides)) {
      const agent = this.agents.get(agentId)
      if (!agent) continue
      if (override.name) {
        agent.name = override.name
        agent.initials = initialsFor(override.name)
      }
      if (override.role) agent.role = override.role
      if (override.about !== undefined) agent.about = override.about
    }
  }

  private saveOverrides(): void {
    try {
      fs.mkdirSync(path.dirname(this.overridesPath), { recursive: true })
      fs.writeFileSync(this.overridesPath, JSON.stringify(this.overrides, null, 2) + '\n')
    } catch {
      // overrides are best effort; the running process keeps the in-memory edit
    }
  }

  updateDockerTotals(): void {
    const dockerAgents = this.runtimeAgents().filter((agent) => agent.source === 'docker')
    this.docker.total = dockerAgents.length
    this.docker.online = dockerAgents.filter((agent) => agent.online).length
  }

  setDockerStatus(patch: Partial<DockerStatus>): void {
    Object.assign(this.docker, patch)
    this.updateDockerTotals()
  }

  setDockerAgentState(
    agentId: string,
    state: DockerAgentState,
    online: boolean,
  ): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.source !== 'docker') return

    const wasOnline = agent.online
    agent.dockerState = state
    agent.online = online

    if (online && !wasOnline) {
      agent.lastActive = Date.now()
      if (!agent.task && !agent.trip && agent.status === 'offline') {
        agent.status = 'idle'
      }
      this.emit('status', agent.id, `${agent.name} Docker'da çevrimiçi`)
    } else if (!online && wasOnline) {
      agent.status = 'offline'
      agent.activity = undefined
      this.emit('status', agent.id, `${agent.name} Docker'da çevrimdışı`)
    } else if (!online) {
      agent.status = 'offline'
    }

    this.updateDockerTotals()
  }

  finishDockerTask(agentId: string, status: string): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.source !== 'docker' || !agent.task) return

    // A run poll can observe a stale terminal status for a session while a
    // freshly handed-off task is still starting. Let the bridge or the next
    // poll settle it instead of erasing the office-owned task immediately.
    if (Date.now() - agent.task.startedAt < 6000) return

    const title = agent.task.title
    if (status === 'failed' || status === 'cancelled') {
      this.emit('status', agent.id, `${agent.name} görevi tamamlayamadı`, {
        detail: title,
      })
    } else {
      this.emit('task_done', agent.id, title)
    }

    agent.task = null
    agent.activity = undefined
    agent.lastActive = Date.now()

    if (agent.queue.length > 0) {
      const next = agent.queue.shift()!
      this.startTask(agent, next)
      return
    }

    agent.status = agent.online ? 'idle' : 'offline'
    agent.nextIdleAt = this.now + 6000
  }

  failDockerDispatch(agentId: string, message: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.status = 'blocked'
    agent.task = null
    agent.activity = message.slice(0, 120)
    agent.lastActive = Date.now()
    this.emit('status', agent.id, `${agent.name}: ${message.slice(0, 120)}`)
  }

  updateAgentProfile(
    agentId: string,
    patch: { name?: string; role?: string; about?: string },
  ): Agent | null {
    const agent = this.agents.get(agentId)
    if (!agent) return null

    const name = patch.name?.trim().slice(0, 48)
    const role = patch.role?.trim().slice(0, 48)
    const about = patch.about?.trim().slice(0, 400)

    if (name) {
      agent.name = name
      agent.initials = initialsFor(name)
    }
    if (role) agent.role = role
    if (about !== undefined) agent.about = about

    this.overrides[agentId] = {
      ...this.overrides[agentId],
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
      ...(about !== undefined ? { about } : {}),
    }
    this.saveOverrides()
    this.emit('status', agent.id, `${agent.name} profili güncellendi`)
    return this.serialize(agent)
  }

  private seedAgents(): void {
    for (const seed of this.seed.agents) {
      const floor = this.floor(seed.floor)
      if (!floor) continue
      const desk = floor.desks[seed.slot % floor.desks.length]
      if (!desk) continue

      const isDocker = config.docker.enabled && Boolean(seed.profile)
      const agent: RuntimeAgent = {
        id: seed.id,
        name: seed.name,
        role: seed.role,
        floor: seed.floor,
        deskId: desk.id,
        color: seed.color,
        initials: initialsFor(seed.name),
        status: isDocker ? 'offline' : 'idle',
        source: isDocker ? 'docker' : 'demo',
        model: seed.model,
        profile: seed.profile,
        port: seed.port,
        dockerState: isDocker ? 'unknown' : undefined,
        about: seed.description,
        task: null,
        queue: [],
        x: desk.seat.x,
        y: floor.top + desk.seat.y,
        facing: desk.row === 'top' ? 0 : 0,
        inElevator: false,
        bubble: null,
        lastActive: this.now,
        online: !isDocker,
        home: { ...desk.seat },
        homeFloor: seed.floor,
        steps: [],
        stepIndex: 0,
        stepStartedAt: 0,
        trip: null,
        awaitingElevator: false,
        nextIdleAt: this.now + 4000 + Math.random() * 9000,
        nextCoffeeAt: this.now + 25000 + Math.random() * 40000,
        taskRate: 100 / (50 + Math.random() * 30),
      }
      desk.agentId = agent.id
      this.agents.set(agent.id, agent)
    }
  }

  private seedScenario(): void {
    this.emit('system', undefined, 'Ofis açıldı', {
      detail: config.docker.enabled
        ? 'Docker agentları bekleniyor. Gateway sağlık kontrolleri başlıyor.'
        : 'Simülasyon hazır. Hermes bağlandığında canlı akış başlar.',
    })

    const seeds: { id: string; title: string; detail: string; progress: number }[] = [
      {
        id: 'atlas',
        title: 'Q4 strateji planı',
        detail: 'Katman öncelikleri ve agent kapasitesi',
        progress: 34,
      },
      {
        id: 'bora',
        title: 'Ödeme akışı refactor',
        detail: 'Idempotency ve retry davranışı',
        progress: 52,
      },
      {
        id: 'ece',
        title: 'Kurumsal panel revizyonu',
        detail: 'Yoğunluk ve tipografi geçişi',
        progress: 21,
      },
      {
        id: 'lale',
        title: 'Kasım bülteni',
        detail: 'Lansman notları ve görsel seçkisi',
        progress: 68,
      },
    ]

    for (const item of seeds) {
      const agent = this.agents.get(item.id)
      if (!agent || agent.source !== 'demo') continue
      agent.task = {
        id: randomUUID(),
        title: item.title,
        detail: item.detail,
        assignedBy: 'Ofis',
        startedAt: this.now - Math.round((item.progress / 100) * 45000),
        progress: item.progress,
      }
      agent.status = 'working'
      agent.lastActive = this.now
      agent.taskRate = 100 / (48 + Math.random() * 26)
      this.emit('task_started', agent.id, item.title)
    }
  }

  tick(dtSeconds: number, now = Date.now()): void {
    this.now = now
    const dt = clamp(dtSeconds, 0, 0.5)

    for (const agent of this.agents.values()) {
      this.updateMovement(agent, now, dt)
    }
    this.updateElevator(now, dt)
    this.updateProgress(dt)

    for (const agent of this.agents.values()) {
      if (agent.bubble && now > agent.bubble.until) agent.bubble = null
    }
  }

  private updateProgress(dt: number): void {
    if (!this.simulator.running) return
    const speed = this.simulator.speed

    for (const agent of this.agents.values()) {
      const task = agent.task
      if (!task || task.progress === null) continue
      if (agent.status !== 'working') continue
      if (agent.source === 'hermes' || agent.source === 'docker') continue
      if (agent.trip) continue

      task.progress = clamp(task.progress + agent.taskRate * dt * speed, 0, 100)
      if (task.progress >= 100) this.completeTask(agent)
    }
  }

  private completeTask(agent: RuntimeAgent): void {
    const task = agent.task
    if (!task) return

    this.emit('task_done', agent.id, task.title)
    agent.task = null
    agent.activity = undefined
    agent.lastActive = Date.now()

    if (agent.queue.length > 0) {
      const next = agent.queue.shift()!
      this.startTask(agent, next)
      return
    }

    agent.status = 'idle'
    agent.nextIdleAt = this.now + 9000 + Math.random() * 17000
    agent.nextCoffeeAt = this.now + 22000 + Math.random() * 35000
  }

  private startTask(agent: RuntimeAgent, task: Task, announce = true): void {
    task.startedAt = Date.now()
    agent.task = task
    agent.activity = undefined
    agent.lastActive = Date.now()
    if (task.progress !== null) {
      agent.taskRate = 100 / (40 + Math.random() * 36)
    }
    if (!agent.trip) agent.status = 'working'
    if (announce) this.emit('task_started', agent.id, task.title)
    if (agent.source === 'docker') this.onTaskStarted?.(agent, task)
  }

  assignTask(
    agentId: string,
    title: string,
    detail?: string,
    assignedBy?: string,
  ): { ok: boolean; queued?: boolean; error?: string; agent?: Agent } {
    const agent = this.agents.get(agentId)
    if (!agent) return { ok: false, error: 'Agent bulunamadı.' }
    if (agent.source === 'docker' && !agent.online) {
      return { ok: false, error: `${agent.name} şu anda çevrimdışı. Önce Docker profilini başlat.` }
    }

    const cleanTitle = String(title ?? '').trim().slice(0, 140)
    if (!cleanTitle) return { ok: false, error: 'Görev başlığı boş olamaz.' }

    const live = agent.source === 'hermes' || agent.source === 'docker'
    const task: Task = {
      id: randomUUID(),
      title: cleanTitle,
      detail: detail ? String(detail).trim().slice(0, 280) : undefined,
      assignedBy: assignedBy?.slice(0, 80),
      startedAt: Date.now(),
      progress: live ? null : 0,
      live,
    }

    if (!agent.online) {
      agent.online = true
      agent.status = agent.trip ? agent.status : 'idle'
    }

    if (agent.task || agent.trip || agent.status === 'blocked') {
      agent.queue.push(task)
      return { ok: true, queued: true, agent: this.serialize(agent) }
    }

    this.startTask(agent, task)
    return { ok: true, queued: false, agent: this.serialize(agent) }
  }

  delegate(
    fromId: string,
    toId: string,
    title: string,
    detail?: string,
  ): { ok: boolean; error?: string } {
    const from = this.agents.get(fromId)
    const to = this.agents.get(toId)
    if (!from || !to) return { ok: false, error: 'Agent bulunamadı.' }
    if (from.id === to.id) return { ok: false, error: 'Bir agent işi kendine devredemez.' }
    if (!this.isAtDesk(from)) return { ok: false, error: `${from.name} şu anda masasında değil.` }
    if (!this.isAtDesk(to)) return { ok: false, error: `${to.name} şu anda masasında değil.` }

    const cleanTitle = String(title ?? '').trim().slice(0, 140)
    if (!cleanTitle) return { ok: false, error: 'Görev başlığı boş olamaz.' }

    const task: Task = {
      id: randomUUID(),
      title: cleanTitle,
      detail: detail ? String(detail).trim().slice(0, 280) : undefined,
      assignedBy: from.name,
      startedAt: Date.now(),
      progress: to.source === 'hermes' || to.source === 'docker' ? null : 0,
      live: to.source === 'hermes' || to.source === 'docker',
    }

    from.trip = { kind: 'delegation', phase: 'out', targetId: to.id, task }
    from.steps = this.planWalk(
      from.homeFloor,
      from.home,
      to.homeFloor,
      this.visitPoint(to.homeFloor, to.home),
    )
    from.steps.push({ kind: 'wait', ms: 550 })
    from.steps.push({ kind: 'action', action: 'handoff' })
    from.steps.push({ kind: 'wait', ms: 900 })
    from.steps.push({ kind: 'action', action: 'return' })
    from.stepIndex = 0
    from.stepStartedAt = this.now
    from.status = 'delegating'
    from.awaitingElevator = false
    from.bubble = {
      text: to.homeFloor === from.homeFloor ? 'Bir saniye, yanına geliyorum.' : 'Asansörle yanına geliyorum.',
      kind: 'speech',
      until: this.now + 3200,
    }
    from.lastActive = this.now

    this.emit('delegation', from.id, cleanTitle, { targetId: to.id, detail })
    return { ok: true }
  }

  sendToCoffee(agent: RuntimeAgent): boolean {
    if (!this.isAtDesk(agent) || agent.task || agent.queue.length > 0) return false
    agent.trip = { kind: 'coffee', phase: 'out' }
    agent.steps = this.planWalk(agent.homeFloor, agent.home, agent.homeFloor, COFFEE_POINT)
    agent.steps.push({ kind: 'wait', ms: 8000 })
    agent.steps.push({ kind: 'action', action: 'coffeeDone' })
    agent.stepIndex = 0
    agent.stepStartedAt = this.now
    agent.status = 'coffee'
    agent.awaitingElevator = false
    agent.bubble = { text: 'Kısa bir kahve molası.', kind: 'speech', until: this.now + 3000 }
    agent.lastActive = this.now
    agent.nextCoffeeAt = this.now + 45000 + Math.random() * 50000
    return true
  }

  private updateMovement(agent: RuntimeAgent, now: number, dt: number): void {
    if (agent.inElevator) {
      agent.x = ELEVATOR_CAB.x
      agent.y = this.elevatorY
      return
    }
    if (agent.steps.length === 0) return

    const step = agent.steps[agent.stepIndex]
    if (!step) {
      agent.steps = []
      agent.stepIndex = 0
      if (agent.trip) this.settleAtDesk(agent)
      return
    }

    if (step.kind === 'walk') {
      const targetY = this.floorTop(agent.floor) + step.y
      const dx = step.x - agent.x
      const dy = targetY - agent.y
      const distance = Math.hypot(dx, dy)
      const speed = 168

      if (distance < 0.75) {
        agent.x = step.x
        agent.y = targetY
        agent.stepIndex += 1
        agent.stepStartedAt = now
        return
      }

      const travel = Math.min(distance, speed * dt)
      agent.x += (dx / distance) * travel
      agent.y += (dy / distance) * travel
      if (Math.abs(dx) > 2) agent.facing = dx > 0 ? 1 : -1
      return
    }

    if (step.kind === 'elevator') {
      if (!agent.awaitingElevator) {
        this.elevatorQueue.push({ agentId: agent.id, from: agent.floor, to: step.toFloor })
        agent.awaitingElevator = true
      }
      const index = this.elevatorQueue.findIndex((item) => item.agentId === agent.id)
      agent.x = ELEVATOR_WAIT.x - Math.max(0, index) * 22
      agent.y = this.floorTop(agent.floor) + ELEVATOR_WAIT.y
      agent.facing = 1
      return
    }

    if (step.kind === 'wait') {
      if (now - agent.stepStartedAt >= step.ms) {
        agent.stepIndex += 1
        agent.stepStartedAt = now
      }
      return
    }

    if (step.kind === 'action') {
      agent.stepIndex += 1
      agent.stepStartedAt = now
      this.runAction(agent, step.action)
    }
  }

  private runAction(agent: RuntimeAgent, action: TripAction): void {
    const trip = agent.trip
    if (action === 'handoff') {
      if (!trip || trip.kind !== 'delegation' || !trip.targetId || !trip.task) return
      const target = this.agents.get(trip.targetId)
      if (!target) return

      const task = trip.task
      target.lastActive = this.now
      target.online = true

      if (target.task || target.trip) {
        target.queue.unshift(task)
      } else {
        this.startTask(target, task, false)
      }

      target.bubble = { text: 'Aldım, hemen bakıyorum.', kind: 'speech', until: this.now + 4500 }
      agent.bubble = { text: 'Teşekkürler, sende.', kind: 'speech', until: this.now + 3000 }
      this.emit('handoff', target.id, task.title, { targetId: agent.id })
      return
    }

    if (action === 'return') {
      if (!trip || trip.kind !== 'delegation' || !trip.targetId) return
      const target = this.agents.get(trip.targetId)
      if (!target) return
      trip.phase = 'back'
      agent.status = 'walking'
      agent.steps = this.planWalk(
        agent.floor,
        this.visitPoint(agent.floor, target.home),
        agent.homeFloor,
        agent.home,
      )
      agent.steps.push({ kind: 'action', action: 'tripDone' })
      agent.stepIndex = 0
      agent.stepStartedAt = this.now
      agent.inElevator = false
      agent.awaitingElevator = false
      return
    }

    if (action === 'coffeeDone') {
      agent.status = 'walking'
      agent.steps = this.planWalk(agent.floor, COFFEE_POINT, agent.homeFloor, agent.home)
      agent.steps.push({ kind: 'action', action: 'tripDone' })
      agent.stepIndex = 0
      agent.stepStartedAt = this.now
      if (agent.trip) agent.trip.phase = 'back'
      return
    }

    if (action === 'tripDone') {
      this.settleAtDesk(agent)
    }
  }

  private settleAtDesk(agent: RuntimeAgent): void {
    agent.trip = null
    agent.steps = []
    agent.stepIndex = 0
    agent.inElevator = false
    agent.awaitingElevator = false
    agent.floor = agent.homeFloor
    agent.x = agent.home.x
    agent.y = this.floorTop(agent.homeFloor) + agent.home.y
    agent.facing = 0
    agent.lastActive = this.now

    if (!agent.online) {
      agent.status = 'offline'
      agent.task = null
      agent.queue = []
      return
    }

    if (!agent.task && agent.queue.length > 0) {
      const next = agent.queue.shift()!
      this.startTask(agent, next)
      return
    }

    agent.status = agent.task ? 'working' : 'idle'
    if (!agent.task) {
      agent.nextIdleAt = this.now + 7000 + Math.random() * 14000
    }
  }

  private updateElevator(now: number, dt: number): void {
    if (this.elevatorRider) {
      const rider = this.elevatorRider
      const agent = this.agents.get(rider.agentId)
      if (!agent) {
        this.elevatorRider = null
        return
      }

      agent.x = ELEVATOR_CAB.x
      agent.y = this.elevatorY
      agent.inElevator = true

      if (!this.elevatorMoving) {
        if (now >= this.elevatorBoardingUntil) this.elevatorMoving = true
        return
      }

      const targetY = this.floorTop(rider.toFloor) + ELEVATOR_WAIT.y
      const diff = targetY - this.elevatorY
      const step = 330 * dt
      if (Math.abs(diff) <= step) {
        this.elevatorY = targetY
        this.elevatorMoving = false
        this.elevatorFloor = rider.toFloor
        this.elevatorRider = null
        agent.inElevator = false
        agent.floor = rider.toFloor
        agent.x = ELEVATOR_CAB.x
        agent.y = this.elevatorY
        agent.awaitingElevator = false
        agent.stepIndex += 1
        agent.stepStartedAt = now
      } else {
        this.elevatorY += Math.sign(diff) * step
      }
      return
    }

    const head = this.elevatorQueue[0]
    if (!head) return

    const pickupY = this.floorTop(head.from) + ELEVATOR_WAIT.y
    if (Math.abs(this.elevatorY - pickupY) > 0.5) {
      const diff = pickupY - this.elevatorY
      const step = 330 * dt
      this.elevatorY += Math.sign(diff) * Math.min(Math.abs(diff), step)
      this.elevatorMoving = Math.abs(this.elevatorY - pickupY) > 0.5
      if (!this.elevatorMoving) this.elevatorFloor = head.from
      return
    }

    this.elevatorFloor = head.from
    this.elevatorMoving = false
    this.elevatorQueue.shift()
    this.elevatorRider = { agentId: head.agentId, toFloor: head.to }
    this.elevatorBoardingUntil = now + 380

    const agent = this.agents.get(head.agentId)
    if (agent) {
      agent.inElevator = true
      agent.x = ELEVATOR_CAB.x
      agent.y = this.elevatorY
      agent.facing = 1
    }
  }

  private planWalk(fromFloor: number, from: Point, toFloor: number, to: Point): Step[] {
    if (fromFloor === toFloor) {
      return [
        { kind: 'walk', x: from.x, y: CORRIDOR_Y },
        { kind: 'walk', x: to.x, y: CORRIDOR_Y },
        { kind: 'walk', x: to.x, y: to.y },
      ]
    }

    return [
      { kind: 'walk', x: from.x, y: CORRIDOR_Y },
      { kind: 'walk', x: ELEVATOR_WAIT.x, y: ELEVATOR_WAIT.y },
      { kind: 'elevator', toFloor },
      { kind: 'walk', x: ELEVATOR_WAIT.x, y: CORRIDOR_Y },
      { kind: 'walk', x: to.x, y: CORRIDOR_Y },
      { kind: 'walk', x: to.x, y: to.y },
    ]
  }

  private visitPoint(floorNumber: number, seat: Point): Point {
    const floor = this.floor(floorNumber)
    if (!floor) return seat
    const desk = floor.desks.find(
      (candidate) =>
        Math.abs(candidate.seat.x - seat.x) < 2 && Math.abs(candidate.seat.y - seat.y) < 2,
    )
    return desk ? desk.visit : { x: seat.x + 46, y: seat.y }
  }

  private isAtDesk(agent: RuntimeAgent): boolean {
    return (
      agent.trip === null &&
      agent.steps.length === 0 &&
      !agent.inElevator &&
      agent.status !== 'offline' &&
      agent.status !== 'blocked' &&
      agent.online
    )
  }

  findFreeDesk(): { floor: number; desk: Desk } | null {
    const sortedFloors = [...this.layout.floors].sort((a, b) => {
      const aCount = a.desks.filter((desk) => desk.agentId).length
      const bCount = b.desks.filter((desk) => desk.agentId).length
      return aCount - bCount
    })

    for (const floor of sortedFloors) {
      for (const preferred of [0, 1, 2, 3, 4, 5].map(slotOrder)) {
        const desk = floor.desks[preferred]
        if (desk && !desk.agentId) return { floor: floor.number, desk }
      }
    }
    return null
  }

  provisionAgent(input: ProvisionInput): { agent: RuntimeAgent; created: boolean } {
    const existingId = this.sessionMap.get(input.sessionId)
    if (existingId) {
      const existing = this.agents.get(existingId)
      if (existing) {
        if (input.name) {
          existing.name = input.name.slice(0, 48)
          existing.initials = initialsFor(existing.name)
        }
        if (input.role) existing.role = input.role.slice(0, 48)
        if (input.model) existing.model = input.model.slice(0, 80)
        if (input.platform) existing.platform = input.platform.slice(0, 40)
        existing.online = true
        return { agent: existing, created: false }
      }
    }

    const free = this.findFreeDesk()
    if (!free) throw new Error('Ofiste boş masa kalmadı.')

    const code = shortId(input.sessionId).slice(0, 4).toLocaleUpperCase('tr-TR')
    const name = (input.name || `Ajan ${code}`).slice(0, 48)
    const id = `hs-${shortId(input.sessionId)}`
    const floor = this.floor(free.floor)!
    const color = AUTO_COLORS[this.agents.size % AUTO_COLORS.length]

    const agent: RuntimeAgent = {
      id,
      name,
      role: (input.role || 'Hermes ajanı').slice(0, 48),
      floor: free.floor,
      deskId: free.desk.id,
      color,
      initials: initialsFor(name),
      status: 'idle',
      source: 'hermes',
      model: input.model?.slice(0, 80),
      platform: input.platform?.slice(0, 40),
      task: null,
      queue: [],
      x: free.desk.seat.x,
      y: floor.top + free.desk.seat.y,
      facing: 0,
      inElevator: false,
      bubble: null,
      lastActive: Date.now(),
      online: true,
      home: { ...free.desk.seat },
      homeFloor: free.floor,
      steps: [],
      stepIndex: 0,
      stepStartedAt: 0,
      trip: null,
      awaitingElevator: false,
      nextIdleAt: Date.now() + 5000,
      nextCoffeeAt: Date.now() + 60000,
      taskRate: 100 / 60,
    }

    free.desk.agentId = agent.id
    this.agents.set(agent.id, agent)
    this.sessionMap.set(input.sessionId, agent.id)
    this.emit('session', agent.id, `${agent.name} ofise katıldı`, {
      detail: input.platform ? `${input.platform} oturumu` : 'Hermes oturumu',
    })
    return { agent, created: true }
  }

  setStatus(
    agentId: string,
    status: AgentStatus,
    options: {
      taskTitle?: string
      progress?: number | null
      activity?: string | null
      model?: string
      platform?: string
    } = {},
  ): { ok: boolean; error?: string } {
    const agent = this.agents.get(agentId)
    if (!agent) return { ok: false, error: 'Agent bulunamadı.' }

    if (options.model) agent.model = options.model.slice(0, 80)
    if (options.platform) agent.platform = options.platform.slice(0, 40)
    agent.lastActive = Date.now()
    agent.online = status !== 'offline'

    if (options.activity !== undefined) {
      agent.activity = options.activity ? String(options.activity).slice(0, 80) : undefined
    }

    if (options.taskTitle) {
      const title = String(options.taskTitle).trim().slice(0, 140)
      const dockerOwnedTask = agent.source === 'docker' && agent.task !== null

      if (title && dockerOwnedTask) {
        // The office dispatched this task; keep its concise title instead of
        // replacing it with the full user prompt reported by the bridge.
      } else if (title && (!agent.task || agent.task.title !== title)) {
        const task: Task = {
          id: randomUUID(),
          title,
          assignedBy: 'Hermes',
          startedAt: Date.now(),
          progress: null,
          live: true,
        }
        agent.task = task
        agent.queue = []
        this.emit('task_started', agent.id, title)
      }
    }

    if (options.progress !== undefined && agent.task) {
      agent.task.progress =
        options.progress === null ? null : clamp(Number(options.progress), 0, 100)
    }

    if (status === 'offline') {
      agent.status = 'offline'
      agent.task = null
      agent.activity = undefined
      agent.bubble = null
      this.emit('status', agent.id, `${agent.name} çevrimdışı oldu`)
      return { ok: true }
    }

    if (agent.trip || agent.inElevator) {
      return { ok: true }
    }

    if (status === 'idle') {
      // A Docker gateway can emit a session_end for a previous session just as
      // a newly dispatched run starts. Do not let that stale event erase the
      // task the office has just handed to the agent; the run poller will
      // reconcile the real completion.
      if (
        agent.source === 'docker' &&
        agent.task &&
        Date.now() - agent.task.startedAt < 6000
      ) {
        return { ok: true }
      }

      if (agent.task) {
        this.emit('task_done', agent.id, agent.task.title)
        agent.task = null
      }
      agent.status = 'idle'
      agent.activity = undefined
      agent.nextIdleAt = this.now + 8000
      return { ok: true }
    }

    if (status === 'blocked') {
      agent.status = 'blocked'
      this.emit('status', agent.id, `${agent.name} onay bekliyor`)
      return { ok: true }
    }

    if (status === 'working') {
      agent.status = 'working'
      agent.online = true
      if (!agent.task) {
        agent.task = {
          id: randomUUID(),
          title: options.activity ? String(options.activity).slice(0, 140) : 'Hermes görevi',
          assignedBy: 'Hermes',
          startedAt: Date.now(),
          progress: null,
          live: true,
        }
      }
      return { ok: true }
    }

    agent.status = status
    return { ok: true }
  }

  setSimulator(patch: Partial<SimulatorState>): SimulatorState {
    if (typeof patch.demo === 'boolean') this.simulator.demo = patch.demo
    if (typeof patch.running === 'boolean') this.simulator.running = patch.running
    if (typeof patch.speed === 'number' && Number.isFinite(patch.speed)) {
      this.simulator.speed = clamp(patch.speed, 0.5, 4)
    }
    this.onSimulator?.({ ...this.simulator })
    return { ...this.simulator }
  }

  emit(
    type: OfficeEvent['type'],
    agentId: string | undefined,
    title: string,
    options: { targetId?: string; detail?: string } = {},
  ): OfficeEvent {
    const event: OfficeEvent = {
      id: randomUUID(),
      ts: Date.now(),
      type,
      agentId,
      targetId: options.targetId,
      title,
      detail: options.detail,
    }
    this.events.unshift(event)
    if (this.events.length > 150) this.events.length = 150
    this.onEvent?.(event)
    return event
  }

  eventsSince(timestamp: number): OfficeEvent[] {
    return this.events.filter((event) => event.ts > timestamp)
  }

  private serialize(agent: RuntimeAgent): Agent {
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      floor: agent.floor,
      homeFloor: agent.homeFloor,
      deskId: agent.deskId,
      color: agent.color,
      initials: agent.initials,
      status: agent.online ? agent.status : 'offline',
      source: agent.source,
      model: agent.model,
      platform: agent.platform,
      profile: agent.profile,
      port: agent.port,
      dockerState: agent.dockerState,
      about: agent.about,
      task: cloneTask(agent.task),
      queue: agent.queue.map((task) => ({ ...task })),
      x: agent.x,
      y: agent.y,
      facing: agent.facing,
      inElevator: agent.inElevator,
      bubble: agent.bubble ? { ...agent.bubble } : null,
      activity: agent.activity,
      lastActive: agent.lastActive,
      online: agent.online,
    }
  }

  agentsPublic(): Agent[] {
    return this.runtimeAgents().map((agent) => this.serialize(agent))
  }

  elevatorState(): ElevatorState {
    return {
      floor: this.elevatorFloor,
      cabY: this.elevatorY,
      moving: this.elevatorMoving,
      riderId: this.elevatorRider?.agentId ?? null,
      queue: this.elevatorQueue.map((item) => item.agentId),
    }
  }

  snapshot(): Snapshot {
    this.updateDockerTotals()
    return {
      now: Date.now(),
      layout: this.layout,
      agents: this.agentsPublic(),
      elevator: this.elevatorState(),
      simulator: { ...this.simulator },
      docker: { ...this.docker },
      events: this.events.slice(0, 60),
      version: 1,
    }
  }

  tickState(): {
    agents: Agent[]
    elevator: ElevatorState
    simulator: SimulatorState
    docker: DockerStatus
    now: number
  } {
    this.updateDockerTotals()
    return {
      agents: this.agentsPublic(),
      elevator: this.elevatorState(),
      simulator: { ...this.simulator },
      docker: { ...this.docker },
      now: Date.now(),
    }
  }
}

export type { AgentSource, Bubble }
