import type { HermesEvent } from '../shared/types'
import type { OfficeStore, RuntimeAgent } from './store'

function toolLabel(toolName: string): string {
  const labels: Record<string, string> = {
    terminal: 'terminal komutu',
    process: 'süreç yönetimi',
    read_file: 'dosya okuma',
    write_file: 'dosya yazma',
    patch: 'kod düzenleme',
    search: 'kod araması',
    web_search: 'web araştırması',
    web_extract: 'sayfa okuma',
    browser_navigate: 'tarayıcı görevi',
    browser_snapshot: 'sayfa inceleme',
    delegate_task: 'alt görev dağıtımı',
    todo: 'plan güncellemesi',
    memory: 'hafıza güncellemesi',
    cronjob: 'zamanlanmış görev',
  }
  return labels[toolName] ?? toolName.replace(/_/g, ' ').slice(0, 60)
}

function resolveMappedAgent(
  store: OfficeStore,
  agentId: string | undefined,
  sessionId: string | undefined,
  fallback: { model?: string; platform?: string } = {},
): RuntimeAgent | null {
  if (!agentId) return null
  const mapped = store.getAgent(agentId)
  if (!mapped) return null
  if (sessionId) store.linkSession(sessionId, mapped.id)
  if (fallback.model) mapped.model = fallback.model.slice(0, 80)
  if (fallback.platform) mapped.platform = fallback.platform.slice(0, 40)
  return mapped
}

function ensureAgent(
  store: OfficeStore,
  sessionId: string | undefined,
  fallback: { name?: string; role?: string; model?: string; platform?: string } = {},
): RuntimeAgent | null {
  if (!sessionId) return null
  const existing = store.findBySession(sessionId)
  if (existing) {
    if (fallback.name) {
      existing.name = fallback.name.slice(0, 48)
      existing.initials = existing.name.slice(0, 2).toLocaleUpperCase('tr-TR')
    }
    if (fallback.role && existing.role === 'Hermes ajanı') {
      existing.role = fallback.role.slice(0, 48)
    }
    if (fallback.model) existing.model = fallback.model.slice(0, 80)
    if (fallback.platform) existing.platform = fallback.platform.slice(0, 40)
    return existing
  }

  try {
    return store.provisionAgent({
      sessionId,
      name: fallback.name,
      role: fallback.role,
      model: fallback.model,
      platform: fallback.platform,
    }).agent
  } catch (error) {
    store.emit('system', undefined, 'Yeni agent için masa bulunamadı', {
      detail: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export function handleHermesEvent(store: OfficeStore, event: HermesEvent): void {
  const base = {
    model: event.model,
    platform: event.platform,
  }

  if (event.type === 'subagent_start') {
    const parentSession = event.parentSessionId ?? event.sessionId
    const parent =
      resolveMappedAgent(store, event.agentId, parentSession, base) ??
      ensureAgent(store, parentSession, base)
    if (!parent) return
    const child = ensureAgent(store, event.childSessionId, {
      ...base,
      name: event.agentName || event.childRole,
      role: event.childRole || 'Alt ajan',
    })
    if (!child) return
    if (!parent.online) return

    const title = (event.taskTitle || event.childRole || 'Alt görev').slice(0, 140)
    const result = store.delegate(parent.id, child.id, title, event.detail)
    if (!result.ok) {
      store.assignTask(child.id, title, event.detail, parent.name)
      store.emit('delegation', parent.id, title, { targetId: child.id, detail: result.error })
    }
    return
  }

  if (event.type === 'subagent_stop') {
    const child = ensureAgent(store, event.childSessionId, { ...base, role: event.childRole })
    if (!child || !child.online) return
    store.setStatus(child.id, 'idle', { ...base, progress: null })
    return
  }

  const sessionId = event.sessionId ?? event.parentSessionId
  const agent =
    resolveMappedAgent(store, event.agentId, sessionId, base) ??
    ensureAgent(store, sessionId, {
      ...base,
      name: event.agentName,
      role: event.role,
    })
  if (!agent) return
  if (event.type !== 'session_start' && event.type !== 'session_finalize' && !agent.online) {
    return
  }

  switch (event.type) {
    case 'session_start': {
      store.setStatus(agent.id, 'idle', base)
      break
    }
    case 'llm_start': {
      store.setStatus(agent.id, 'working', {
        ...base,
        taskTitle: event.taskTitle,
        activity: event.taskTitle ? undefined : agent.activity,
      })
      break
    }
    case 'tool_start': {
      const activity = event.toolName ? toolLabel(event.toolName) : event.activity
      store.setStatus(agent.id, 'working', {
        ...base,
        activity,
        taskTitle: agent.task ? undefined : activity,
      })
      break
    }
    case 'tool_end': {
      store.setStatus(agent.id, 'working', { ...base, activity: null, progress: undefined })
      break
    }
    case 'llm_end':
    case 'session_end': {
      store.setStatus(agent.id, 'idle', base)
      break
    }
    case 'session_finalize': {
      store.setStatus(agent.id, 'offline', base)
      break
    }
    default:
      break
  }
}
