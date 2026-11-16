import type { OfficeStore, RuntimeAgent } from './store'

const TASK_POOL: { title: string; detail: string }[] = [
  { title: 'Rakip fiyatlandırma analizi', detail: 'Son çeyrek verileri ve konumlandırma karşılaştırması' },
  { title: 'Ödeme akışı refactor', detail: 'Idempotency, retry ve hata durumları' },
  { title: 'Onboarding akışı testleri', detail: 'Yeni kullanıcı adımlarının uçtan uca kontrolü' },
  { title: 'API dokümantasyonu', detail: 'Yeni endpointler ve örnek istekler' },
  { title: 'Sprint planı revizyonu', detail: 'Kapasite ve bağımlılık güncellemesi' },
  { title: 'Müşteri geri bildirim triyajı', detail: 'Son 40 talebin önceliklendirilmesi' },
  { title: 'Log pipeline iyileştirmesi', detail: 'Gürültü azaltma ve yeni uyarı kuralları' },
  { title: 'Landing page metinleri', detail: 'Yeni konumlandırma için başlık ve alt metinler' },
  { title: 'Veri modeli temizliği', detail: 'Kullanılmayan alanların ve indekslerin gözden geçirilmesi' },
  { title: 'Erişilebilirlik denetimi', detail: 'Klavye akışı, kontrast ve odak durumları' },
  { title: 'Haftalık performans raporu', detail: 'Gecikme, hata oranı ve maliyet özeti' },
  { title: 'Prompt kütüphanesi güncellemesi', detail: 'Tekrarlanan görevler için yeni şablonlar' },
  { title: 'Maliyet optimizasyonu', detail: 'Model yönlendirme ve önbellek fırsatları' },
  { title: 'Yeni özellik keşfi', detail: 'Kullanıcı akışlarından çıkarılan fırsatlar' },
]

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function atDesk(agent: RuntimeAgent): boolean {
  return (
    agent.trip === null &&
    agent.steps.length === 0 &&
    !agent.inElevator &&
    agent.online &&
    agent.status !== 'offline' &&
    agent.status !== 'blocked' &&
    agent.status !== 'coffee'
  )
}

export class Simulation {
  private nextDelegationAt: number
  private introDelegationDone = false

  constructor(private readonly store: OfficeStore) {
    this.nextDelegationAt = Date.now() + 6500
  }

  tick(now: number): void {
    const simulator = this.store.simulator
    if (!simulator.running || !simulator.demo) return

    const agents = this.store.runtimeAgents()

    for (const agent of agents) {
      if (agent.source !== 'demo') continue
      if (!atDesk(agent) || agent.task || agent.queue.length > 0) continue
      if (now < agent.nextIdleAt) continue

      if (now >= agent.nextCoffeeAt && Math.random() < 0.4) {
        if (this.store.sendToCoffee(agent)) continue
      }

      const task = pick(TASK_POOL)
      this.store.assignTask(agent.id, task.title, task.detail, 'Ofis')
    }

    if (now < this.nextDelegationAt) return

    if (!this.introDelegationDone) {
      this.introDelegationDone = true
      const atlas = this.store.getAgent('atlas')
      const bora = this.store.getAgent('bora')
      if (atlas && bora && atDesk(atlas) && atDesk(bora)) {
        const result = this.store.delegate(
          atlas.id,
          bora.id,
          'Ödeme akışı refactor — gözden geçirme',
          'Retry davranışı ve hata mesajları',
        )
        if (result.ok) {
          this.nextDelegationAt = now + 30000 + Math.random() * 22000
          return
        }
      }
    }

    this.tryDelegation(agents)
    this.nextDelegationAt = now + 28000 + Math.random() * 26000
  }

  private tryDelegation(agents: RuntimeAgent[]): void {
    const available = agents.filter(
      (agent) => agent.source === 'demo' && atDesk(agent) && (agent.status === 'working' || agent.status === 'idle'),
    )
    if (available.length < 2) return

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const from = pick(available)
      const targets = available.filter((agent) => agent.id !== from.id)
      if (targets.length === 0) return
      const to = pick(targets)
      const task = pick(TASK_POOL)

      const result = this.store.delegate(from.id, to.id, task.title, task.detail)
      if (result.ok) return
    }
  }
}
