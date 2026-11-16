import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function parseEnvFile(file: string): void {
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    const key = line.slice(0, equals).trim()
    let value = line.slice(equals + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

export function loadEnvFiles(): void {
  parseEnvFile(path.join(ROOT, '.env'))
  parseEnvFile(path.join(ROOT, 'runtime', 'secrets.env'))
}

loadEnvFiles()

function booleanEnv(name: string, fallback = false): boolean {
  const value = (process.env[name] || '').trim().toLowerCase()
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value)
}

const dockerEnabled = booleanEnv('HERMES_DOCKER', false)
const dataDir = path.resolve(
  ROOT,
  (process.env.HERMES_DATA_DIR || 'runtime/hermes-data').trim(),
)

export const config = {
  port: Number(process.env.PORT || 4173),
  host: process.env.HOST || '0.0.0.0',
  token: (process.env.OFFICE_TOKEN || '').trim(),
  docker: {
    enabled: dockerEnabled,
    container: (process.env.HERMES_CONTAINER || 'kodmoz-hermes').trim(),
    dataDir,
    apiKey: (process.env.HERMES_AGENTS_API_KEY || '').trim(),
    host: (process.env.HERMES_AGENTS_HOST || '127.0.0.1').trim(),
  },
}
