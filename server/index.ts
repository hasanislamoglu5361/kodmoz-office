import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import type { AgentStatus, HermesEvent, SimulatorState } from '../shared/types'
import { OfficeStore } from './store'
import { Simulation } from './simulation'
import { handleHermesEvent } from './hermes'
import { DockerController } from './docker'
import { config, ROOT } from './config'

const PORT = config.port
const HOST = config.host
const TOKEN = config.token

const store = new OfficeStore()
const simulation = new Simulation(store)
const docker = config.docker.enabled ? new DockerController(store) : null

if (docker) {
  store.onTaskStarted = (agent, task) => docker.handleTaskStarted(agent, task)
  docker.start()
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '64kb' }))

function requestToken(req: express.Request): string | null {
  const header = req.headers.authorization
  if (header && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
  const query = req.query.token
  return typeof query === 'string' ? query : null
}

function authorized(req: express.Request): boolean {
  if (!TOKEN) return true
  return requestToken(req) === TOKEN
}

app.use('/api', (req, res, next) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'Yetkisiz istek. Token gerekli.' })
    return
  }
  next()
})

const httpServer = http.createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

function broadcast(payload: unknown): void {
  const message = JSON.stringify(payload)
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message)
  }
}

store.onEvent = (event) => broadcast({ type: 'event', event })
store.onSimulator = (simulator) => broadcast({ type: 'simulator', simulator })

wss.on('connection', (socket, req) => {
  const url = new URL(req.url || '/ws', 'http://localhost')
  if (TOKEN && url.searchParams.get('token') !== TOKEN) {
    socket.close(4401, 'unauthorized')
    return
  }

  socket.send(JSON.stringify({ type: 'snapshot', state: store.snapshot() }))

  socket.on('error', () => {
    // client disappeared; nothing to clean up
  })
})

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.ping()
  }
}, 30000)

let lastTick = Date.now()
const loop = setInterval(() => {
  const now = Date.now()
  const dt = (now - lastTick) / 1000
  lastTick = now
  store.tick(dt, now)
  simulation.tick(now)
  broadcast({ type: 'tick', ...store.tickState() })
}, 100)

app.get('/api/state', (_req, res) => {
  res.json(store.snapshot())
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: Date.now(),
    uptimeSeconds: Math.round(process.uptime()),
    agents: store.agentsPublic().length,
    connections: wss.clients.size,
    simulator: store.simulator,
    docker: store.docker,
    auth: TOKEN ? 'token' : 'open',
  })
})

app.get('/api/events', (req, res) => {
  const since = Number(req.query.since || 0)
  res.json({ events: store.eventsSince(Number.isFinite(since) ? since : 0) })
})

app.post('/api/agents/:id/task', (req, res) => {
  const { title, detail, assignedBy } = req.body ?? {}
  const result = store.assignTask(
    req.params.id,
    typeof title === 'string' ? title : '',
    typeof detail === 'string' ? detail : undefined,
    typeof assignedBy === 'string' ? assignedBy : 'Panel',
  )
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }
  res.json(result)
})

const STATUSES: AgentStatus[] = [
  'idle',
  'working',
  'walking',
  'delegating',
  'coffee',
  'blocked',
  'offline',
]

app.post('/api/agents/:id/status', (req, res) => {
  const body = req.body ?? {}
  const status = body.status as AgentStatus
  if (!STATUSES.includes(status)) {
    res.status(400).json({ error: 'Geçersiz durum.' })
    return
  }
  const result = store.setStatus(req.params.id, status, {
    taskTitle: typeof body.taskTitle === 'string' ? body.taskTitle : undefined,
    progress:
      typeof body.progress === 'number'
        ? body.progress
        : body.progress === null
          ? null
          : undefined,
    activity: typeof body.activity === 'string' ? body.activity : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    platform: typeof body.platform === 'string' ? body.platform : undefined,
  })
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }
  res.json({
    ok: true,
    agent: store.agentsPublic().find((agent) => agent.id === req.params.id),
  })
})

app.post('/api/agents/:id/profile', (req, res) => {
  void (async () => {
    const body = req.body ?? {}
    const patch: { name?: string; role?: string; about?: string } = {}
    if (typeof body.name === 'string') patch.name = body.name
    if (typeof body.role === 'string') patch.role = body.role
    if (typeof body.about === 'string') patch.about = body.about
    if (!patch.name && !patch.role && patch.about === undefined) {
      res.status(400).json({ error: 'Güncellenecek alan yok.' })
      return
    }

    try {
      const agent = store.getAgent(req.params.id)
      if (!agent) {
        res.status(404).json({ error: 'Agent bulunamadı.' })
        return
      }

      if (docker && agent.source === 'docker') {
        await docker.updateProfile(agent.id, patch)
      } else {
        store.updateAgentProfile(agent.id, patch)
      }

      res.json({
        ok: true,
        agent: store.agentsPublic().find((candidate) => candidate.id === req.params.id),
      })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Profil güncellenemedi.',
      })
    }
  })()
})

app.post('/api/agents/:id/power', (req, res) => {
  void (async () => {
    const action = String(req.body?.action ?? '')
    if (!['start', 'stop', 'restart'].includes(action)) {
      res.status(400).json({ error: 'Geçersiz işlem.' })
      return
    }
    if (!docker) {
      res.status(400).json({ error: 'Docker modu kapalı.' })
      return
    }

    try {
      await docker.power(req.params.id, action as 'start' | 'stop' | 'restart')
      res.json({
        ok: true,
        agent: store.agentsPublic().find((candidate) => candidate.id === req.params.id),
      })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Agent işlemi başarısız.',
      })
    }
  })()
})

app.post('/api/docker/container', (req, res) => {
  void (async () => {
    const action = String(req.body?.action ?? '')
    if (!['start', 'stop', 'restart'].includes(action)) {
      res.status(400).json({ error: 'Geçersiz işlem.' })
      return
    }
    if (!docker) {
      res.status(400).json({ error: 'Docker modu kapalı.' })
      return
    }

    try {
      await docker.containerAction(action as 'start' | 'stop' | 'restart')
      res.json({ ok: true, docker: store.docker })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Konteyner işlemi başarısız.',
      })
    }
  })()
})

app.get('/api/docker/status', (_req, res) => {
  res.json({
    docker: store.docker,
    agents: store
      .agentsPublic()
      .filter((agent) => agent.source === 'docker')
      .map((agent) => ({
        id: agent.id,
        name: agent.name,
        profile: agent.profile,
        port: agent.port,
        online: agent.online,
        state: agent.dockerState,
      })),
  })
})

app.post('/api/delegations', (req, res) => {
  const body = req.body ?? {}
  const from = String(body.from ?? body.fromId ?? '')
  const to = String(body.to ?? body.toId ?? '')
  const title = String(body.title ?? '')
  const detail = typeof body.detail === 'string' ? body.detail : undefined
  const result = store.delegate(from, to, title, detail)
  if (!result.ok) {
    res.status(400).json({ error: result.error })
    return
  }
  res.json({ ok: true })
})

app.post('/api/hermes/event', (req, res) => {
  const event = req.body as HermesEvent
  if (!event || typeof event.type !== 'string') {
    res.status(400).json({ error: 'Geçersiz olay.' })
    return
  }
  try {
    handleHermesEvent(store, event)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Olay işlenemedi.' })
  }
})

app.post('/api/simulator', (req, res) => {
  const body = req.body ?? {}
  const patch: Partial<SimulatorState> = {}
  if (typeof body.running === 'boolean') patch.running = body.running
  if (typeof body.demo === 'boolean') patch.demo = body.demo
  if (typeof body.speed === 'number') patch.speed = body.speed
  const simulator = store.setSimulator(patch)
  res.json({ ok: true, simulator })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Bulunamadı.' })
})

const dist = path.join(ROOT, 'dist')
const hasBuild = existsSync(path.join(dist, 'index.html'))

if (hasBuild) {
  app.use(express.static(dist, { maxAge: '1h', index: false }))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('Kodmoz Ofis API çalışıyor.\nArayüz için: npm run dev → http://localhost:5173\n')
  })
}

function lanAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

httpServer.listen(PORT, HOST, () => {
  const lines = [
    '',
    '  \u001b[1mKODMOZ OFİS\u001b[0m',
    `  Yerel   http://localhost:${PORT}`,
    ...lanAddresses().map((address) => `  Ağ      http://${address}:${PORT}`),
    TOKEN ? '  Token   açık (OFFICE_TOKEN)' : '  Token   kapalı — dışarı açarken OFFICE_TOKEN ayarlayın',
    hasBuild ? '' : '  Geliştirme modu: arayüz http://localhost:5173',
    '',
  ]
  console.log(lines.join('\n'))
})

function shutdown(): void {
  clearInterval(loop)
  clearInterval(heartbeat)
  docker?.stop()
  for (const client of wss.clients) client.close()
  wss.close()
  httpServer.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export { app, store }
