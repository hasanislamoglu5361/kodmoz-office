import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Task } from '../shared/types'
import { config } from './config'
import type { OfficeStore, RuntimeAgent } from './store'

const execFileAsync = promisify(execFile)
const REFRESH_INTERVAL_MS = 5000
const HEALTH_TIMEOUT_MS = 2000

type PowerAction = 'start' | 'stop' | 'restart'
type ContainerAction = 'start' | 'stop' | 'restart'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DockerController {
  private timer: NodeJS.Timeout | null = null
  private refreshing = false
  private readonly runs = new Map<string, string>()

  constructor(private readonly store: OfficeStore) {}

  start(): void {
    if (!config.docker.enabled) return
    if (!config.docker.apiKey) {
      console.warn('[docker] HERMES_AGENTS_API_KEY tanımlı değil; API çağrıları başarısız olur.')
    }
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private dockerAgents(): RuntimeAgent[] {
    return this.store
      .runtimeAgents()
      .filter((agent) => agent.source === 'docker' && Boolean(agent.profile))
  }

  private profileDesiredState(profile: string | undefined): string {
    if (!profile) return 'unknown'
    try {
      const stateFile = path.join(this.profileHome(profile), 'gateway_state.json')
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
        desired_state?: string
      }
      return parsed.desired_state || 'unknown'
    } catch {
      return 'unknown'
    }
  }

  private profileHome(profile: string): string {
    return profile === 'default'
      ? config.docker.dataDir
      : path.join(config.docker.dataDir, 'profiles', profile)
  }

  private gatewayArgs(profile: string, action: string): string[] {
    const profileArgs = profile === 'default' ? [] : ['-p', profile]
    return ['exec', config.docker.container, 'hermes', ...profileArgs, 'gateway', action]
  }

  private async docker(args: string[], timeout = 90000): Promise<string> {
    const { stdout } = await execFileAsync('docker', args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    })
    return stdout
  }

  private async containerState(): Promise<string> {
    try {
      const output = await this.docker(
        ['inspect', '-f', '{{.State.Status}}', config.docker.container],
        10000,
      )
      return output.trim() || 'unknown'
    } catch {
      return 'missing'
    }
  }

  private async checkHealth(port: number | undefined): Promise<boolean> {
    if (!port) return false
    try {
      const response = await fetch(`http://${config.docker.host}:${port}/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async refresh(): Promise<void> {
    if (!config.docker.enabled || this.refreshing) return
    this.refreshing = true
    try {
      const state = await this.containerState()
      const running = state === 'running'
      this.store.setDockerStatus({
        enabled: true,
        container: config.docker.container,
        running,
      })

      const agents = this.dockerAgents()
      await Promise.all(
        agents.map(async (agent) => {
          if (!running) {
            this.store.setDockerAgentState(agent.id, 'stopped', false)
            return
          }

          const healthy = await this.checkHealth(agent.port)
          if (!healthy) {
            const desired = this.profileDesiredState(agent.profile)
            const nextState =
              desired === 'stopped'
                ? 'stopped'
                : agent.dockerState === 'starting'
                  ? 'starting'
                  : 'error'
            this.store.setDockerAgentState(agent.id, nextState, false)
            return
          }

          this.store.setDockerAgentState(agent.id, 'running', true)
          await this.pollRun(agent)
        }),
      )
    } finally {
      this.refreshing = false
      this.store.updateDockerTotals()
    }
  }

  private async pollRun(agent: RuntimeAgent): Promise<void> {
    const runId = this.runs.get(agent.id)
    if (!runId) return
    if (!agent.task) {
      this.runs.delete(agent.id)
      return
    }
    if (!agent.port) return

    try {
      const response = await fetch(
        `http://${config.docker.host}:${agent.port}/v1/runs/${encodeURIComponent(runId)}`,
        {
          headers: this.authHeaders(),
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS + 1000),
        },
      )
      if (!response.ok) return
      const data = (await response.json()) as { status?: string }
      if (data.status && ['completed', 'failed', 'cancelled'].includes(data.status)) {
        this.runs.delete(agent.id)
        this.store.finishDockerTask(agent.id, data.status)
      }
    } catch {
      // transient; the next poll retries
    }
  }

  private authHeaders(): Record<string, string> {
    return config.docker.apiKey
      ? { Authorization: `Bearer ${config.docker.apiKey}` }
      : {}
  }

  async dispatch(agentId: string, task: Task): Promise<void> {
    const agent = this.store.getAgent(agentId)
    if (!agent || agent.source !== 'docker' || !agent.port) {
      throw new Error('Docker agent yapılandırması bulunamadı.')
    }

    const input = task.detail ? `${task.title}\n\n${task.detail}` : task.title
    const response = await fetch(
      `http://${config.docker.host}:${agent.port}/v1/runs`,
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          session_id: `kodmoz-office-${agent.id}`,
          store: true,
        }),
        signal: AbortSignal.timeout(25000),
      },
    )

    const payload = (await response.json().catch(() => null)) as
      | { run_id?: string; id?: string; error?: { message?: string } }
      | null

    if (!response.ok) {
      throw new Error(payload?.error?.message || `Agent API ${response.status}`)
    }

    const runId = payload?.run_id || payload?.id
    if (runId) {
      this.runs.set(agent.id, runId)
    }
  }

  handleTaskStarted(agent: RuntimeAgent, task: Task): void {
    void this.dispatch(agent.id, task).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      this.store.failDockerDispatch(agent.id, `Görev gönderilemedi: ${message}`)
    })
  }

  async power(agentId: string, action: PowerAction): Promise<void> {
    const agent = this.store.getAgent(agentId)
    if (!agent || agent.source !== 'docker' || !agent.profile) {
      throw new Error('Bu agent bir Docker profili değil.')
    }

    const state = await this.containerState()
    if (state !== 'running') {
      if (action === 'stop') return
      await this.docker(['start', config.docker.container], 90000)
      await sleep(2500)
      await this.refresh()
    }

    this.store.setDockerAgentState(
      agent.id,
      action === 'stop' ? 'stopped' : 'starting',
      action === 'stop' ? false : agent.online,
    )
    await this.docker(this.gatewayArgs(agent.profile, action), 120000)
    await sleep(action === 'stop' ? 1200 : 2200)
    await this.refresh()
  }

  async containerAction(action: ContainerAction): Promise<void> {
    await this.docker([action, config.docker.container], 120000)
    if (action !== 'stop') {
      await sleep(2500)
    }
    await this.refresh()
  }

  async updateProfile(
    agentId: string,
    patch: { name?: string; role?: string; about?: string },
  ): Promise<RuntimeAgent | null> {
    const updated = this.store.updateAgentProfile(agentId, patch)
    if (!updated) return null

    const agent = this.store.getAgent(agentId)
    if (!agent || agent.source !== 'docker' || !agent.profile) return agent ?? null

    const home = this.profileHome(agent.profile)
    fs.mkdirSync(home, { recursive: true })

    const about = agent.about || ''
    const soul = `# ${agent.name}

Sen **Kodmoz Ofis**'te **${agent.role}** rolünde çalışan bir Hermes agentısın.

${about}

## Çalışma ilkeleri

- Görevlerini ofis panelinden alırsın; kısa, net ve uygulanabilir sonuç üret.
- Gerektiğinde araçlarını kullan; varsayım yapmak yerine doğrula.
- Sonucu teslim ederken ne yaptığını ve varsa riskleri özetle.
`
    fs.writeFileSync(path.join(home, 'SOUL.md'), soul, 'utf8')

    const envPath = path.join(home, '.env')
    this.upsertEnv(envPath, {
      HERMES_OFFICE_AGENT_ID: agent.id,
      HERMES_OFFICE_AGENT_NAME: agent.name,
      HERMES_OFFICE_ROLE: agent.role,
    })

    if (agent.online || agent.dockerState === 'running') {
      await this.power(agent.id, 'restart')
    }

    return agent
  }

  private upsertEnv(file: string, values: Record<string, string>): void {
    const next = new Map<string, string>()
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue
        const equals = line.indexOf('=')
        if (equals <= 0) continue
        next.set(line.slice(0, equals).trim(), line.slice(equals + 1))
      }
    }

    for (const [key, value] of Object.entries(values)) {
      next.set(key, JSON.stringify(value))
    }

    const body =
      [...next.entries()].map(([key, value]) => `${key}=${value}`).join('\n') + '\n'
    fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 })
  }
}
