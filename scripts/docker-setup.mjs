#!/usr/bin/env node
/**
 * Kodmoz Office — 10 Hermes agent için tek konteyner / 10 profil kurulumu.
 *
 * Kullanım:
 *   node scripts/docker-setup.mjs            # kur / onar
 *   node scripts/docker-setup.mjs --reset-soul  # SOUL.md dosyalarını seed'den yeniden yaz
 *
 * Gizli değerler runtime/secrets.env dosyasından okunur. Bu dosya git'e girmez.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = path.resolve(ROOT, process.env.HERMES_DATA_DIR || 'runtime/hermes-data')
const CONTAINER = (process.env.HERMES_CONTAINER || 'kodmoz-hermes').trim()
const IMAGE = process.env.HERMES_IMAGE || 'nousresearch/hermes-agent:latest'
const SECRETS_FILE = path.join(ROOT, 'runtime', 'secrets.env')
const RESET_SOUL = process.argv.includes('--reset-soul')

function parseEnvFile(file) {
  const result = {}
  if (!fs.existsSync(file)) return result
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    let value = line.slice(equals + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[line.slice(0, equals).trim()] = value
  }
  return result
}

const fileSecrets = parseEnvFile(SECRETS_FILE)
const secrets = {
  baseUrl: process.env.HERMES_LLM_BASE_URL || fileSecrets.HERMES_LLM_BASE_URL,
  model: process.env.HERMES_LLM_MODEL || fileSecrets.HERMES_LLM_MODEL,
  llmKey: process.env.HERMES_LLM_API_KEY || fileSecrets.HERMES_LLM_API_KEY,
  agentsKey: process.env.HERMES_AGENTS_API_KEY || fileSecrets.HERMES_AGENTS_API_KEY,
  officeUrl: process.env.OFFICE_URL || fileSecrets.OFFICE_URL || 'http://host.docker.internal:4173',
}

if (!secrets.baseUrl || !secrets.model || !secrets.llmKey || !secrets.agentsKey) {
  console.error(
    'Eksik yapılandırma. runtime/secrets.env içinde HERMES_LLM_BASE_URL, HERMES_LLM_MODEL, HERMES_LLM_API_KEY ve HERMES_AGENTS_API_KEY olmalı.',
  )
  process.exit(1)
}

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'office.json'), 'utf8'))
const agents = seed.agents.filter((agent) => agent.profile && agent.port)
if (agents.length === 0) {
  console.error("data/office.json içinde profile/port tanımlı agent yok.")
  process.exit(1)
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: options.timeout ?? 180000,
    stdio: options.inherit ? 'inherit' : 'pipe',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFail) {
    const stderr = (result.stderr || '').trim()
    throw new Error(`docker ${args.join(' ')} başarısız: ${stderr.slice(0, 600)}`)
  }
  return result
}

function execHermes(args, options = {}) {
  return runDocker(['exec', CONTAINER, 'hermes', ...args], options)
}

function containerState() {
  const result = runDocker(
    ['inspect', '-f', '{{.State.Status}}', CONTAINER],
    { allowFail: true, timeout: 15000 },
  )
  return (result.stdout || '').trim() || 'missing'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitHealth(port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) return true
    } catch {
      // retry
    }
    await sleep(1000)
  }
  return false
}

function upsertEnv(file, values) {
  const lines = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.trim())
    : []
  const keep = lines.filter((line) => {
    const equals = line.indexOf('=')
    if (equals <= 0) return true
    return !(line.slice(0, equals).trim() in values)
  })
  const body =
    [...keep, ...Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`)]
      .join('\n') + '\n'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 })
}

function soulFor(agent) {
  return `# ${agent.name}

Sen **Kodmoz Ofis**'te **${agent.role}** rolünde çalışan bir Hermes agentısın.

${agent.description || ''}

## Çalışma ilkeleri

- Görevlerini ofis panelinden alırsın; kısa, net ve uygulanabilir sonuç üret.
- Gerektiğinde araçlarını kullan; varsayım yapmak yerine doğrula.
- Sonucu teslim ederken ne yaptığını ve varsa riskleri özetle.
`
}

function defaultConfig() {
  return `model:
  provider: "custom"
  base_url: ${JSON.stringify(secrets.baseUrl)}
  api_key: ${JSON.stringify(secrets.llmKey)}
  default: ${JSON.stringify(secrets.model)}
  context_length: 200000
agent:
  max_turns: 60
terminal:
  backend: local
  cwd: /opt/data/work
gateway:
  multiplex_profiles: true
`
}

function profileHome(profile) {
  return profile === 'default'
    ? DATA_DIR
    : path.join(DATA_DIR, 'profiles', profile)
}

function copyPlugin(home) {
  const source = path.join(ROOT, 'hermes-plugin', 'hermes-office')
  const target = path.join(home, 'plugins', 'hermes-office')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, {
    recursive: true,
    filter: (file) => !file.includes('__pycache__'),
  })
}

function profileEnv(agent) {
  return {
    API_SERVER_ENABLED: 'true',
    API_SERVER_HOST: '0.0.0.0',
    API_SERVER_PORT: String(agent.port),
    API_SERVER_KEY: secrets.agentsKey,
    OFFICE_URL: secrets.officeUrl,
    HERMES_OFFICE_AGENT_ID: agent.id,
    HERMES_OFFICE_AGENT_NAME: agent.name,
    HERMES_OFFICE_ROLE: agent.role,
    HERMES_OFFICE_SEND_TITLES: '1',
  }
}

function containerPortBindings() {
  const result = runDocker(
    ['inspect', '-f', '{{json .HostConfig.PortBindings}}', CONTAINER],
    { allowFail: true, timeout: 15000 },
  )
  return result.stdout || ''
}

async function main() {
  console.log(`Kodmoz Office Docker kurulumu — ${agents.length} agent`)

  if (!runDocker(['image', 'inspect', IMAGE], { allowFail: true, timeout: 20000 }).stdout) {
    console.log(`İmaj yok, çekiliyor: ${IMAGE}`)
    runDocker(['pull', IMAGE], { inherit: true, timeout: 1800000 })
  }

  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'work'), { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'plugins'), { recursive: true })

  const defaultHome = profileHome('default')
  fs.writeFileSync(path.join(defaultHome, 'config.yaml'), defaultConfig(), 'utf8')
  copyPlugin(defaultHome)
  const atlas = agents.find((agent) => agent.profile === 'default') || agents[0]
  upsertEnv(path.join(defaultHome, '.env'), profileEnv(atlas))
  if (RESET_SOUL || !fs.existsSync(path.join(defaultHome, 'SOUL.md'))) {
    fs.writeFileSync(path.join(defaultHome, 'SOUL.md'), soulFor(atlas), 'utf8')
  }

  let state = containerState()
  if (state === 'missing') {
    console.log('Konteyner oluşturuluyor…')
    runDocker(
      [
        'run',
        '-d',
        '--name',
        CONTAINER,
        '--restart',
        'unless-stopped',
        '-v',
        `${DATA_DIR}:/opt/data`,
        '-p',
        '127.0.0.1:8642-8651:8642-8651',
        '-e',
        `HERMES_UID=${process.getuid?.() ?? 1000}`,
        '-e',
        `HERMES_GID=${process.getgid?.() ?? 1000}`,
        IMAGE,
        'gateway',
        'run',
      ],
      { timeout: 120000 },
    )
  } else if (state !== 'running') {
    console.log('Konteyner başlatılıyor…')
    runDocker(['start', CONTAINER], { timeout: 120000 })
  } else {
    const bindings = containerPortBindings()
    if (!bindings.includes('127.0.0.1')) {
      console.log(
        'Uyarı: API portları localhost’a bağlı değil. Güvenlik için konteyneri yeniden oluşturman önerilir.',
      )
    }
  }

  console.log('Default gateway bekleniyor…')
  if (!(await waitHealth(atlas.port, 90000))) {
    runDocker(['logs', '--tail', '80', CONTAINER], { allowFail: true, timeout: 20000 })
    throw new Error('Default API server 8642 üzerinde açılmadı.')
  }

  execHermes(['plugins', 'enable', 'hermes-office'], { allowFail: true, timeout: 60000 })

  for (const agent of agents) {
    if (agent.profile === 'default') continue
    const home = profileHome(agent.profile)
    if (!fs.existsSync(home)) {
      console.log(`Profil oluşturuluyor: ${agent.profile}`)
      execHermes(
        [
          'profile',
          'create',
          agent.profile,
          '--clone',
          '--description',
          `${agent.role} agentı`,
        ],
        { timeout: 180000 },
      )
    }

    upsertEnv(path.join(home, '.env'), profileEnv(agent))
    if (RESET_SOUL || !fs.existsSync(path.join(home, 'SOUL.md'))) {
      fs.writeFileSync(path.join(home, 'SOUL.md'), soulFor(agent), 'utf8')
    }
    copyPlugin(home)
    execHermes(['-p', agent.profile, 'config', 'set', 'gateway.standalone', 'true'], {
      allowFail: true,
      timeout: 60000,
    })
    execHermes(['-p', agent.profile, 'plugins', 'enable', 'hermes-office'], {
      allowFail: true,
      timeout: 60000,
    })
  }

  console.log('Default gateway profilleri yeniden tarıyor…')
  execHermes(['gateway', 'restart'], { allowFail: true, timeout: 90000 })
  await waitHealth(atlas.port, 60000)
  await sleep(2000)

  for (const agent of agents) {
    if (agent.profile === 'default') continue
    console.log(`Gateway başlatılıyor: ${agent.profile} (:${agent.port})`)
    let started = false
    for (let attempt = 0; attempt < 5 && !started; attempt += 1) {
      const result = execHermes(
        ['-p', agent.profile, 'gateway', 'start'],
        { allowFail: true, timeout: 120000 },
      )
      if (result.status === 0) {
        started = true
      } else {
        await sleep(4000)
      }
    }
    if (!started) console.warn(`  ! ${agent.profile} gateway başlatılamadı`)
  }

  console.log('\nSağlık kontrolü:')
  const rows = []
  for (const agent of agents) {
    const healthy = await waitHealth(agent.port, 45000)
    rows.push(`${healthy ? '✓' : '✗'} ${agent.name.padEnd(8)} ${agent.profile.padEnd(8)} :${agent.port}`)
  }
  console.log(rows.join('\n'))
  console.log(
    '\nHazır. Ofis sunucusunu `npm start` ile çalıştır; arayüz agentları otomatik olarak Docker üzerinden yönetir.',
  )
}

main().catch((error) => {
  console.error('\nKurulum hatası:', error instanceof Error ? error.message : error)
  process.exit(1)
})
