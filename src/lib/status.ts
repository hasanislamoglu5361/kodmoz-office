import type { AgentStatus, OfficeEvent, Point } from '../../shared/types'

export const STATUS_META: Record<
  AgentStatus,
  { label: string; color: string; soft: string; description: string }
> = {
  working: {
    label: 'Çalışıyor',
    color: '#7bd8b0',
    soft: 'rgba(123, 216, 176, 0.16)',
    description: 'Görev üzerinde aktif',
  },
  idle: {
    label: 'Boşta',
    color: '#98a0aa',
    soft: 'rgba(152, 160, 170, 0.14)',
    description: 'Masa başında, görev bekliyor',
  },
  walking: {
    label: 'Yolda',
    color: '#e8b45a',
    soft: 'rgba(232, 180, 90, 0.16)',
    description: 'Ofis içinde hareket ediyor',
  },
  delegating: {
    label: 'Devrediyor',
    color: '#f0a35e',
    soft: 'rgba(240, 163, 94, 0.17)',
    description: 'Bir işi teslim ediyor',
  },
  coffee: {
    label: 'Molada',
    color: '#d9a066',
    soft: 'rgba(217, 160, 102, 0.15)',
    description: 'Kahve molasında',
  },
  blocked: {
    label: 'Onay bekliyor',
    color: '#e06c5e',
    soft: 'rgba(224, 108, 94, 0.16)',
    description: 'Bir onay veya girdi bekliyor',
  },
  offline: {
    label: 'Çevrimdışı',
    color: '#5f6570',
    soft: 'rgba(95, 101, 112, 0.14)',
    description: 'Ofiste değil',
  },
}

export const EVENT_META: Record<
  OfficeEvent['type'],
  { glyph: string; color: string; label: string }
> = {
  task_started: { glyph: '▶', color: '#7bd8b0', label: 'Görev' },
  task_done: { glyph: '✓', color: '#8fd18a', label: 'Tamamlandı' },
  delegation: { glyph: '→', color: '#e8b45a', label: 'Devir' },
  handoff: { glyph: '⇄', color: '#f0a35e', label: 'Teslim' },
  status: { glyph: '●', color: '#98a0aa', label: 'Durum' },
  session: { glyph: '◈', color: '#6fb3ff', label: 'Oturum' },
  tool: { glyph: '⚙', color: '#9aa7b4', label: 'Araç' },
  system: { glyph: '◇', color: '#b9a17a', label: 'Sistem' },
}

export function floorLabel(floor: number): string {
  return `K${floor}`
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, Math.round((now - timestamp) / 1000))
  if (diff < 10) return 'şimdi'
  if (diff < 60) return `${diff} sn`
  if (diff < 3600) return `${Math.floor(diff / 60)} dk`
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa`
  return new Date(timestamp).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })
}

export function elapsedLabel(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds} sn`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} dk`
  return `${Math.floor(minutes / 60)} sa ${minutes % 60} dk`
}

export function clockLabel(date = new Date()): string {
  return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

export function pointDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
