import { spawn } from 'node:child_process'

const children = [
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'watch', 'server/index.ts'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  }),
]

let stopping = false
function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 200)
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) shutdown(code ?? 0)
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
