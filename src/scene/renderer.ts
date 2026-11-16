import type { Agent, ElevatorState, OfficeLayout } from '../../shared/types'
import { STATUS_META } from '../lib/status'
import {
  FLOOR_RUGS,
  FLOOR_TINTS,
  HAIR_COLORS,
  PALETTE,
  SKIN_TONES,
} from './palette'

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

const ROOF_TOP = -46
const BASE_BOTTOM = 22
const MIN_SCALE = 0.2
const MAX_SCALE = 2.2

export interface CameraState {
  x: number
  y: number
  scale: number
}

export type SceneHit =
  | { kind: 'agent'; id: string }
  | { kind: 'floor'; floor: number }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value
  const number = Number.parseInt(full, 16)
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const target = amount >= 0 ? 255 : 0
  const strength = Math.abs(amount)
  const mix = (channel: number) => Math.round(channel + (target - channel) * strength)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
      if (lines.length === maxLines - 1) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)

  if (lines.length === 0) return [text]
  const last = lines[lines.length - 1]
  if (ctx.measureText(last).width > maxWidth) {
    let trimmed = last
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1)
    }
    lines[lines.length - 1] = `${trimmed}…`
  } else if (words.join(' ').length > lines.join(' ').length) {
    let trimmed = last
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
      trimmed = trimmed.slice(0, -1)
    }
    lines[lines.length - 1] = `${trimmed}…`
  }
  return lines
}

export class OfficeRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private layout: OfficeLayout

  private agents: Agent[] = []
  private elevator: ElevatorState = {
    floor: 1,
    cabY: 0,
    moving: false,
    riderId: null,
    queue: [],
  }
  private selectedId: string | null = null
  private hoveredId: string | null = null

  private display = new Map<string, { x: number; y: number }>()
  private agentsByDesk = new Map<string, Agent>()
  private floorHits: { floor: number; x: number; y: number; w: number; h: number }[] = []

  private camera: CameraState = { x: 620, y: 680, scale: 0.5 }
  private cameraTarget: CameraState | null = null
  private width = 1
  private height = 1
  private dpr = 1
  private initialized = false
  private mobile = false
  private time = 0
  private backgroundCache: HTMLCanvasElement | null = null
  private userAdjusted = false

  constructor(canvas: HTMLCanvasElement, layout: OfficeLayout) {
    this.canvas = canvas
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D bağlamı açılamadı.')
    this.ctx = context
    this.layout = layout
  }

  setLayout(layout: OfficeLayout): void {
    this.layout = layout
    if (this.width > 1 && this.height > 1) {
      this.fit(false)
      this.initialized = true
    }
  }

  setData(
    agents: Agent[],
    elevator: ElevatorState,
    selectedId: string | null,
    hoveredId: string | null,
  ): void {
    this.agents = agents
    this.elevator = elevator
    this.selectedId = selectedId
    this.hoveredId = hoveredId
  }

  setViewport(width: number, height: number, dpr: number, mobile: boolean): void {
    this.mobile = mobile
    const nextWidth = Math.max(1, Math.round(width))
    const nextHeight = Math.max(1, Math.round(height))
    const nextDpr = Math.max(1, Math.min(3, dpr))

    if (
      nextWidth === this.width &&
      nextHeight === this.height &&
      nextDpr === this.dpr
    ) {
      return
    }

    this.width = nextWidth
    this.height = nextHeight
    this.dpr = nextDpr
    this.backgroundCache = null
    this.canvas.width = Math.round(nextWidth * nextDpr)
    this.canvas.height = Math.round(nextHeight * nextDpr)
    this.canvas.style.width = `${nextWidth}px`
    this.canvas.style.height = `${nextHeight}px`

    if (!this.initialized) {
      this.fit(false)
      this.initialized = true
    } else if (!this.userAdjusted) {
      this.fit(false)
    }
  }

  fit(animate = true): void {
    this.userAdjusted = false
    const padding = this.mobile ? 18 : 54
    const minX = -26
    const maxX = this.layout.width + 26
    const minY = ROOF_TOP - 24
    const maxY = this.layout.height + BASE_BOTTOM + 12
    const scale = clamp(
      Math.min(
        (this.width - padding * 2) / (maxX - minX),
        (this.height - padding * 2) / (maxY - minY),
      ),
      MIN_SCALE,
      MAX_SCALE,
    )

    this.moveCamera(
      {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2 - 10,
        scale,
      },
      animate,
    )
  }

  focusFloor(floorNumber: number, animate = true): void {
    const floor = this.layout.floors.find((candidate) => candidate.number === floorNumber)
    if (!floor) return
    this.userAdjusted = true
    const narrow = this.width < 700
    const visibleWidth = narrow ? 900 : 1240
    const scale = clamp(
      Math.min(
        (this.width - (narrow ? 26 : 70)) / visibleWidth,
        (this.height - 90) / (this.layout.floorHeight + 30),
      ),
      0.26,
      1.5,
    )
    this.moveCamera(
      {
        x: narrow ? 470 : this.layout.width / 2,
        y: floor.top + this.layout.floorHeight / 2 - 4,
        scale,
      },
      animate,
    )
  }

  focusAgent(agentId: string, animate = true): void {
    const agent = this.agents.find((candidate) => candidate.id === agentId)
    if (!agent) return
    this.userAdjusted = true
    const position = this.display.get(agentId) ?? { x: agent.x, y: agent.y }
    this.moveCamera(
      {
        x: position.x,
        y: position.y - 12,
        scale: clamp(Math.max(this.camera.scale, this.mobile ? 1.15 : 1.02), 0.5, 1.8),
      },
      animate,
    )
  }

  private moveCamera(target: CameraState, animate: boolean): void {
    if (!animate) {
      this.camera = { ...target }
      this.cameraTarget = null
      return
    }
    this.cameraTarget = target
  }

  panBy(dx: number, dy: number): void {
    this.userAdjusted = true
    this.cameraTarget = null
    this.camera.x -= dx / this.camera.scale
    this.camera.y -= dy / this.camera.scale
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    this.userAdjusted = true
    this.cameraTarget = null
    const before = this.screenToWorld(screenX, screenY)
    this.camera.scale = clamp(this.camera.scale * factor, MIN_SCALE, MAX_SCALE)
    const after = this.screenToWorld(screenX, screenY)
    this.camera.x += before.x - after.x
    this.camera.y += before.y - after.y
  }

  initialZoom(): void {
    this.fit(true)
  }

  screenToWorld(x: number, y: number): { x: number; y: number } {
    return {
      x: this.camera.x + (x - this.width / 2) / this.camera.scale,
      y: this.camera.y + (y - this.height / 2) / this.camera.scale,
    }
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.camera.x) * this.camera.scale + this.width / 2,
      y: (y - this.camera.y) * this.camera.scale + this.height / 2,
    }
  }

  hitTest(screenX: number, screenY: number): SceneHit | null {
    const point = this.screenToWorld(screenX, screenY)
    let best: { id: string; distance: number } | null = null

    for (const agent of this.agents) {
      const position = this.display.get(agent.id) ?? { x: agent.x, y: agent.y }
      const padX = this.screenPx(20)
      const padTop = this.screenPx(38)
      const padBottom = this.screenPx(34)
      if (
        point.x >= position.x - padX &&
        point.x <= position.x + padX &&
        point.y >= position.y - padTop &&
        point.y <= position.y + padBottom
      ) {
        const distance = Math.hypot(point.x - position.x, point.y - (position.y - 6))
        if (!best || distance < best.distance) best = { id: agent.id, distance }
      }
    }

    if (best) return { kind: 'agent', id: best.id }

    for (const area of this.floorHits) {
      if (
        point.x >= area.x &&
        point.x <= area.x + area.w &&
        point.y >= area.y &&
        point.y <= area.y + area.h
      ) {
        return { kind: 'floor', floor: area.floor }
      }
    }
    return null
  }

  render(deltaMs: number): void {
    const dt = Math.min(0.05, Math.max(0, deltaMs / 1000))
    this.time += dt
    this.updateCamera(dt)
    this.updateDisplay(dt)
    this.draw()
  }

  private updateCamera(dt: number): void {
    if (!this.cameraTarget) return
    const target = this.cameraTarget
    const blend = 1 - Math.exp(-dt * 7.5)
    this.camera.x += (target.x - this.camera.x) * blend
    this.camera.y += (target.y - this.camera.y) * blend
    this.camera.scale += (target.scale - this.camera.scale) * blend

    if (
      Math.abs(target.x - this.camera.x) < 0.4 &&
      Math.abs(target.y - this.camera.y) < 0.4 &&
      Math.abs(target.scale - this.camera.scale) < 0.0015
    ) {
      this.camera = { ...target }
      this.cameraTarget = null
    }
  }

  private updateDisplay(dt: number): void {
    const seen = new Set<string>()
    for (const agent of this.agents) {
      seen.add(agent.id)
      const current = this.display.get(agent.id)
      if (!current) {
        this.display.set(agent.id, { x: agent.x, y: agent.y })
        continue
      }
      const distance = Math.hypot(agent.x - current.x, agent.y - current.y)
      if (distance > 220) {
        current.x = agent.x
        current.y = agent.y
        continue
      }
      const blend = 1 - Math.exp(-dt * 13)
      current.x += (agent.x - current.x) * blend
      current.y += (agent.y - current.y) * blend
    }

    for (const key of this.display.keys()) {
      if (!seen.has(key)) this.display.delete(key)
    }
  }

  private screenPx(pixels: number): number {
    return pixels / this.camera.scale
  }

  private draw(): void {
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    this.drawBackground()

    ctx.save()
    ctx.translate(this.width / 2, this.height / 2)
    ctx.scale(this.camera.scale, this.camera.scale)
    ctx.translate(-this.camera.x, -this.camera.y)

    this.drawRoof()
    this.floorHits = []
    this.agentsByDesk.clear()
    for (const agent of this.agents) this.agentsByDesk.set(agent.deskId, agent)

    const floors = [...this.layout.floors].sort((a, b) => a.top - b.top)
    for (const floor of floors) this.drawFloor(floor)
    this.drawShaft()
    this.drawCabBody()

    const sorted = [...this.agents].sort((a, b) => {
      const pa = this.display.get(a.id) ?? a
      const pb = this.display.get(b.id) ?? b
      return pa.y - pb.y
    })
    for (const agent of sorted) this.drawAgent(agent)
    this.drawCabGlass()
    this.drawBase()
    ctx.restore()
  }

  private drawBackground(): void {
    if (!this.backgroundCache) {
      const cache = document.createElement('canvas')
      cache.width = Math.max(1, Math.round(this.width * this.dpr))
      cache.height = Math.max(1, Math.round(this.height * this.dpr))
      const cacheCtx = cache.getContext('2d')
      if (!cacheCtx) return
      cacheCtx.scale(this.dpr, this.dpr)

      const gradient = cacheCtx.createLinearGradient(0, 0, this.width * 0.35, this.height)
      gradient.addColorStop(0, PALETTE.bgTop)
      gradient.addColorStop(1, PALETTE.bgBottom)
      cacheCtx.fillStyle = gradient
      cacheCtx.fillRect(0, 0, this.width, this.height)

      const glow = cacheCtx.createRadialGradient(
        this.width * 0.46,
        this.height * 0.22,
        10,
        this.width * 0.46,
        this.height * 0.22,
        this.width * 0.7,
      )
      glow.addColorStop(0, PALETTE.glow)
      glow.addColorStop(1, 'rgba(232, 180, 90, 0)')
      cacheCtx.fillStyle = glow
      cacheCtx.fillRect(0, 0, this.width, this.height)

      cacheCtx.fillStyle = PALETTE.grid
      const spacing = 26
      for (let x = 0; x < this.width + spacing; x += spacing) {
        for (let y = 0; y < this.height + spacing; y += spacing) {
          cacheCtx.fillRect(x, y, 1, 1)
        }
      }

      const radius = Math.max(this.width, this.height) * 0.75
      const vignette = cacheCtx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        radius * 0.35,
        this.width / 2,
        this.height / 2,
        radius,
      )
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.34)')
      cacheCtx.fillStyle = vignette
      cacheCtx.fillRect(0, 0, this.width, this.height)

      this.backgroundCache = cache
    }

    this.ctx.drawImage(this.backgroundCache, 0, 0, this.width, this.height)
  }

  private drawRoof(): void {
    const ctx = this.ctx
    const width = this.layout.width
    const y = ROOF_TOP
    const height = 38

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
    roundedPath(ctx, -10, y, width + 20, height, 9)
    ctx.fillStyle = PALETTE.slabDark
    ctx.fill()
    ctx.restore()

    roundedPath(ctx, -10, y, width + 20, height, 9)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, y + 4, width, 1)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${this.screenPx(12)}px ${FONT_STACK}`
    ctx.fillStyle = PALETTE.brass
    ctx.fillText('KODMOZ OFİS', width / 2, y + height / 2 + 1)

    ctx.font = `500 ${this.screenPx(6.5)}px ${FONT_STACK}`
    ctx.fillStyle = 'rgba(242, 234, 220, 0.42)'
    ctx.fillText('AGENT KATI', width / 2, y + height / 2 + this.screenPx(11))

    const antennaX = width - 150
    ctx.strokeStyle = 'rgba(220, 210, 192, 0.35)'
    ctx.lineWidth = this.screenPx(1)
    ctx.beginPath()
    ctx.moveTo(antennaX, y)
    ctx.lineTo(antennaX, y - this.screenPx(16))
    ctx.stroke()

    const pulse = 0.5 + Math.sin(this.time * 2.1) * 0.5
    ctx.beginPath()
    ctx.arc(antennaX, y - this.screenPx(17), this.screenPx(2.2), 0, Math.PI * 2)
    ctx.fillStyle = `rgba(224, 108, 94, ${0.4 + pulse * 0.5})`
    ctx.fill()

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  private drawBase(): void {
    const ctx = this.ctx
    const y = this.layout.height
    roundedPath(ctx, -10, y, this.layout.width + 20, BASE_BOTTOM, 8)
    ctx.fillStyle = PALETTE.slabDark
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.stroke()

    ctx.fillStyle = 'rgba(232, 180, 90, 0.22)'
    ctx.fillRect(0, y + 6, this.layout.width, 1)
  }

  private drawFloor(floor: OfficeLayout['floors'][number]): void {
    const ctx = this.ctx
    const top = floor.top
    const height = this.layout.floorHeight
    const bottom = top + height
    const surfaceInset = 7
    const slabBottom = 21

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.42)'
    ctx.shadowBlur = 28
    ctx.shadowOffsetY = 12
    roundedPath(ctx, -4, top, this.layout.width + 8, height, 12)
    ctx.fillStyle = PALETTE.slabDark
    ctx.fill()
    ctx.restore()

    ctx.save()
    roundedPath(ctx, -4, top, this.layout.width + 8, height, 12)
    ctx.fillStyle = PALETTE.slab
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.stroke()

    const surfaceX = surfaceInset
    const surfaceY = top + surfaceInset
    const surfaceW = this.layout.width - surfaceInset * 2
    const surfaceH = height - surfaceInset - slabBottom

    roundedPath(ctx, surfaceX, surfaceY, surfaceW, surfaceH, 7)
    ctx.fillStyle = FLOOR_TINTS[floor.number] ?? PALETTE.floorLight
    ctx.fill()
    ctx.clip()

    const wood = ctx.createLinearGradient(surfaceX, surfaceY, surfaceX, surfaceY + surfaceH)
    wood.addColorStop(0, 'rgba(255,255,255,0.10)')
    wood.addColorStop(0.55, 'rgba(255,255,255,0)')
    wood.addColorStop(1, 'rgba(60,40,20,0.09)')
    ctx.fillStyle = wood
    ctx.fillRect(surfaceX, surfaceY, surfaceW, surfaceH)

    ctx.strokeStyle = PALETTE.plank
    ctx.lineWidth = 1
    for (let y = surfaceY + 30; y < surfaceY + surfaceH; y += 30) {
      ctx.beginPath()
      ctx.moveTo(surfaceX, y)
      ctx.lineTo(surfaceX + surfaceW, y)
      ctx.stroke()
    }

    const random = mulberry32(floor.number * 719 + 17)
    ctx.strokeStyle = PALETTE.plankDark
    for (let row = 0; row < Math.ceil(surfaceH / 30); row += 1) {
      const seamCount = 4
      for (let seam = 0; seam < seamCount; seam += 1) {
        const x = surfaceX + 80 + random() * (surfaceW - 160)
        const y = surfaceY + row * 30
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, Math.min(surfaceY + surfaceH, y + 30))
        ctx.stroke()
      }
    }

    drawWindowBand(ctx, surfaceX + 80, surfaceY + 10, surfaceW - 260, 8)

    const lightRandom = mulberry32(floor.number * 131 + 9)
    for (let index = 0; index < 3; index += 1) {
      const lx = 280 + index * 240 + lightRandom() * 50
      const ly = top + 150 + lightRandom() * 90
      const light = ctx.createRadialGradient(lx, ly, 6, lx, ly, 130)
      light.addColorStop(0, 'rgba(255, 240, 210, 0.055)')
      light.addColorStop(1, 'rgba(255, 240, 210, 0)')
      ctx.fillStyle = light
      ctx.fillRect(lx - 130, ly - 130, 260, 260)
    }

    drawRunner(ctx, floor, top)
    this.drawCoffeeCorner(floor, top)
    this.drawLounge(floor, top)
    this.drawWhiteboard(floor, top)
    this.drawBookshelf(floor, top)
    this.drawPlants(floor, top)

    for (const desk of floor.desks) drawDesk(ctx, floor, desk, this.agentsByDesk.get(desk.id), this.time)

    ctx.restore()

    ctx.fillStyle = PALETTE.slabDark
    ctx.fillRect(surfaceX, bottom - slabBottom + 2, surfaceW, slabBottom - 4)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(surfaceX, bottom - slabBottom + 2)
    ctx.lineTo(surfaceX + surfaceW, bottom - slabBottom + 2)
    ctx.stroke()

    this.drawFloorPlate(floor)
  }

  private drawFloorPlate(floor: OfficeLayout['floors'][number]): void {
    const ctx = this.ctx
    const x = 24
    const y = floor.top + 28
    const w = 140
    const h = 84

    roundedPath(ctx, x, y, w, h, 9)
    ctx.fillStyle = 'rgba(25, 22, 19, 0.54)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(232, 180, 90, 0.22)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = PALETTE.brass
    ctx.fillRect(x + 10, y + 12, 2, h - 24)

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${this.screenPx(6.8)}px ${FONT_STACK}`
    ctx.fillStyle = 'rgba(242, 234, 220, 0.55)'
    ctx.fillText('KAT', x + 20, y + 16)

    ctx.font = `700 ${this.screenPx(21)}px ${FONT_STACK}`
    ctx.fillStyle = PALETTE.text
    ctx.fillText(String(floor.number), x + 19, y + 40)

    ctx.font = `600 ${this.screenPx(9.5)}px ${FONT_STACK}`
    ctx.fillStyle = 'rgba(242, 234, 220, 0.88)'
    ctx.fillText(floor.name, x + 52, y + 39)

    const occupied = floor.desks.filter((desk) => desk.agentId).length
    ctx.font = `500 ${this.screenPx(7.2)}px ${MONO_STACK}`
    ctx.fillStyle = 'rgba(242, 234, 220, 0.38)'
    ctx.fillText(`${occupied}/${floor.desks.length} masa`, x + 52, y + 55)

    ctx.font = `500 ${this.screenPx(6.6)}px ${FONT_STACK}`
    ctx.fillStyle = 'rgba(242, 234, 220, 0.3)'
    ctx.fillText(floor.subtitle.slice(0, 24), x + 20, y + 72)

    ctx.textBaseline = 'alphabetic'
    this.floorHits.push({ floor: floor.number, x, y, w, h })
  }

  private drawCoffeeCorner(floor: OfficeLayout['floors'][number], top: number): void {
    const ctx = this.ctx
    const x = 846
    const y = top + 34

    roundedPath(ctx, x, y, 168, 44, 6)
    ctx.fillStyle = PALETTE.coffeeDark
    ctx.fill()
    roundedPath(ctx, x, y, 168, 12, 6)
    ctx.fillStyle = PALETTE.coffee
    ctx.fill()

    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(x + 8, y + 12, 152, 1)

    roundedPath(ctx, x + 18, y + 18, 34, 22, 3)
    ctx.fillStyle = '#2a2c2e'
    ctx.fill()
    ctx.fillStyle = '#d9d2c4'
    ctx.fillRect(x + 30, y + 24, 10, 4)
    ctx.fillStyle = '#e06c5e'
    ctx.fillRect(x + 46, y + 22, 2, 2)

    ctx.fillStyle = 'rgba(239, 231, 216, 0.86)'
    for (let index = 0; index < 3; index += 1) {
      roundedPath(ctx, x + 66 + index * 13, y + 26, 7, 8, 2)
      ctx.fill()
    }

    roundedPath(ctx, x + 116, y + 20, 30, 18, 3)
    ctx.fillStyle = 'rgba(239, 231, 216, 0.14)'
    ctx.fill()
    ctx.fillStyle = 'rgba(239, 231, 216, 0.6)'
    ctx.font = `500 ${this.screenPx(5.6)}px ${FONT_STACK}`
    ctx.fillText('KAHVE', x + 121, y + 31)

    const steamAlpha = 0.18 + Math.sin(this.time * 1.7) * 0.06
    ctx.strokeStyle = `rgba(245, 240, 230, ${steamAlpha})`
    ctx.lineWidth = 1.1
    for (let index = 0; index < 2; index += 1) {
      const sx = x + 32 + index * 7
      ctx.beginPath()
      ctx.moveTo(sx, y + 16)
      ctx.bezierCurveTo(
        sx - 3,
        y + 10,
        sx + 3,
        y + 6,
        sx,
        y + 1,
      )
      ctx.stroke()
    }

    ctx.font = `500 ${this.screenPx(6.4)}px ${MONO_STACK}`
    ctx.fillStyle = 'rgba(30, 24, 18, 0.55)'
    ctx.fillText('KAT 0' + floor.number, x + 70, y + 8)
  }

  private drawLounge(floor: OfficeLayout['floors'][number], top: number): void {
    const ctx = this.ctx
    const rugX = 838
    const rugY = top + 258
    const rugW = 282
    const rugH = 144

    roundedPath(ctx, rugX, rugY, rugW, rugH, 16)
    ctx.fillStyle = FLOOR_RUGS[floor.number] ?? PALETTE.rugSage
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'
    ctx.lineWidth = 1
    ctx.stroke()

    roundedPath(ctx, rugX + 26, rugY + 24, 118, 32, 9)
    ctx.fillStyle = PALETTE.chair
    ctx.fill()
    roundedPath(ctx, rugX + 30, rugY + 30, 110, 22, 7)
    ctx.fillStyle = shade(PALETTE.chair, 0.1)
    ctx.fill()

    roundedPath(ctx, rugX + 174, rugY + 34, 32, 86, 9)
    ctx.fillStyle = PALETTE.chairDark
    ctx.fill()
    roundedPath(ctx, rugX + 180, rugY + 40, 20, 74, 7)
    ctx.fillStyle = shade(PALETTE.chairDark, 0.12)
    ctx.fill()

    ctx.beginPath()
    ctx.ellipse(rugX + 115, rugY + 94, 27, 13, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#e3d5bd'
    ctx.fill()
    ctx.strokeStyle = 'rgba(90, 70, 45, 0.2)'
    ctx.stroke()

    drawPlant(ctx, rugX + 248, rugY + 122, 41, this.screenPx)
  }

  private drawWhiteboard(floor: OfficeLayout['floors'][number], top: number): void {
    const ctx = this.ctx
    const x = 84
    const y = top + 282

    roundedPath(ctx, x, y, 84, 62, 4)
    ctx.fillStyle = '#efe7d8'
    ctx.fill()
    ctx.strokeStyle = 'rgba(80, 62, 40, 0.25)'
    ctx.stroke()

    const random = mulberry32(floor.number * 31 + 5)
    ctx.strokeStyle = 'rgba(90, 110, 130, 0.45)'
    ctx.lineWidth = 1
    for (let line = 0; line < 4; line += 1) {
      const ly = y + 14 + line * 10
      ctx.beginPath()
      ctx.moveTo(x + 10, ly)
      ctx.lineTo(x + 10 + 20 + random() * 46, ly)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(168, 92, 72, 0.55)'
    ctx.beginPath()
    ctx.arc(x + 64, y + 42, 8, 0.2, Math.PI * 1.5)
    ctx.stroke()

    ctx.fillStyle = '#8d7860'
    roundedPath(ctx, x + 18, y + 64, 48, 4, 2)
    ctx.fill()
  }

  private drawBookshelf(floor: OfficeLayout['floors'][number], top: number): void {
    const ctx = this.ctx
    const x = 84
    const y = top + 188
    const w = 54
    const h = 68

    roundedPath(ctx, x, y, w, h, 3)
    ctx.fillStyle = '#6d5540'
    ctx.fill()
    ctx.fillStyle = '#57422f'
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8)

    const colors = ['#a45c4a', '#687c5f', '#4e6980', '#b9925e', '#8a6b8f']
    for (let shelf = 0; shelf < 2; shelf += 1) {
      const baseY = y + 30 + shelf * 30
      for (let index = 0; index < 5; index += 1) {
        ctx.fillStyle = colors[(index + shelf + floor.number) % colors.length]
        ctx.fillRect(x + 8 + index * 8, baseY - 18, 5, 16)
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(x + 5, baseY + 1, w - 10, 2)
    }
  }

  private drawPlants(floor: OfficeLayout['floors'][number], top: number): void {
    const ctx = this.ctx
    const random = mulberry32(floor.number * 101 + 3)
    const spots = [
      { x: 202, y: top + 72 },
      { x: 802, y: top + 404 },
      { x: 1090, y: top + 158 },
      { x: 204, y: top + 392 },
    ]
    spots.forEach((spot, index) => {
      drawPlant(ctx, spot.x, spot.y, floor.number * 13 + index * 7 + random() * 10, this.screenPx)
    })
  }

  private drawShaft(): void {
    const ctx = this.ctx
    const shaft = this.layout.shaft
    const x = shaft.x
    const y = shaft.y
    const w = shaft.width
    const h = shaft.height

    ctx.save()
    ctx.fillStyle = 'rgba(12, 16, 19, 0.76)'
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = 'rgba(160, 195, 205, 0.045)'
    ctx.fillRect(x + 6, y, w - 12, h)
    ctx.strokeStyle = PALETTE.glassEdge
    ctx.lineWidth = 1
    ctx.strokeRect(x + 6, y, w - 12, h)

    ctx.strokeStyle = 'rgba(220, 235, 240, 0.08)'
    for (const floor of this.layout.floors) {
      ctx.beginPath()
      ctx.moveTo(x + 6, floor.top)
      ctx.lineTo(x + w - 6, floor.top)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(230, 238, 242, 0.12)'
    ctx.lineWidth = 1
    for (const cableX of [x + 24, x + w - 24]) {
      ctx.beginPath()
      ctx.moveTo(cableX, y)
      ctx.lineTo(cableX, y + h)
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(232, 180, 90, 0.28)'
    for (const floor of this.layout.floors) {
      ctx.fillRect(x + 6, floor.top + 216, 8, 2)
    }
    ctx.restore()
  }

  private drawCabBody(): void {
    const ctx = this.ctx
    const shaft = this.layout.shaft
    const cabY = this.elevator.cabY
    const x = shaft.centerX - 38
    const top = cabY - 46
    const w = 76
    const h = 92

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 18
    roundedPath(ctx, x, top, w, h, 6)
    ctx.fillStyle = '#273235'
    ctx.fill()
    ctx.restore()

    roundedPath(ctx, x + 5, top + 6, w - 10, h - 12, 4)
    ctx.fillStyle = '#1b2426'
    ctx.fill()

    if (this.elevator.moving) {
      ctx.strokeStyle = 'rgba(160, 210, 215, 0.25)'
      ctx.lineWidth = 1
      for (let index = 0; index < 3; index += 1) {
        const ly = top + 20 + ((this.time * 60 + index * 22) % (h - 34))
        ctx.beginPath()
        ctx.moveTo(x + 10, ly)
        ctx.lineTo(x + w - 10, ly)
        ctx.stroke()
      }
    }

    ctx.font = `600 ${this.screenPx(7)}px ${MONO_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(232, 180, 90, 0.8)'
    ctx.fillText(this.elevator.moving ? '•••' : `K${this.elevator.floor}`, x + w / 2, top + 16)

    ctx.strokeStyle = 'rgba(220, 235, 240, 0.16)'
    ctx.beginPath()
    ctx.moveTo(x + w / 2, top + 8)
    ctx.lineTo(x + w / 2, top + h - 8)
    ctx.stroke()

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  private drawCabGlass(): void {
    const ctx = this.ctx
    const shaft = this.layout.shaft
    const cabY = this.elevator.cabY
    const x = shaft.centerX - 38
    const top = cabY - 46
    const w = 76
    const h = 92

    roundedPath(ctx, x, top, w, h, 6)
    ctx.fillStyle = 'rgba(170, 205, 212, 0.08)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(210, 232, 238, 0.28)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.fillStyle = 'rgba(232, 180, 90, 0.55)'
    ctx.fillRect(x + 10, top + 44, 2, 8)
    ctx.fillRect(x + w - 12, top + 44, 2, 8)
  }

  private drawAgent(agent: Agent): void {
    const ctx = this.ctx
    const position = this.display.get(agent.id) ?? { x: agent.x, y: agent.y }
    const { x, y } = position
    const scale = this.camera.scale
    const seed = hashString(agent.id)
    const isSelected = this.selectedId === agent.id
    const isHovered = this.hoveredId === agent.id
    const moving =
      Math.hypot(agent.x - position.x, agent.y - position.y) > 1.4 ||
      (agent.inElevator && this.elevator.moving)
    const statusColor = STATUS_META[agent.status]?.color ?? PALETTE.muted
    const opacity = agent.status === 'offline' ? 0.55 : 1
    const walkPhase = this.time * 11 + seed
    const swing = moving ? Math.sin(walkPhase) * 2.6 : 0

    ctx.save()
    ctx.globalAlpha = opacity

    if (isSelected || isHovered) {
      const glow = ctx.createRadialGradient(x, y + 6, 2, x, y + 6, 38)
      glow.addColorStop(0, rgba(agent.color, isSelected ? 0.26 : 0.14))
      glow.addColorStop(1, rgba(agent.color, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y + 6, 38, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.beginPath()
    ctx.ellipse(x, y + 20, 12.5, 4.4, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(35, 25, 16, 0.25)'
    ctx.fill()

    this.drawGroundStatus(agent, x, y, statusColor, isSelected)

    ctx.lineCap = 'round'
    ctx.strokeStyle = '#2f3a43'
    ctx.lineWidth = this.screenPx(3.4)
    ctx.beginPath()
    ctx.moveTo(x - 4.2, y + 4)
    ctx.lineTo(x - 4.2 + swing, y + 18)
    ctx.moveTo(x + 4.2, y + 4)
    ctx.lineTo(x + 4.2 - swing, y + 18)
    ctx.stroke()

    const bodyGradient = ctx.createLinearGradient(x - 10, y - 12, x + 10, y + 10)
    bodyGradient.addColorStop(0, shade(agent.color, 0.13))
    bodyGradient.addColorStop(1, shade(agent.color, -0.12))
    roundedPath(ctx, x - 10, y - 12, 20, 22, 6)
    ctx.fillStyle = bodyGradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(20, 16, 12, 0.22)'
    ctx.lineWidth = 0.8
    ctx.stroke()

    ctx.strokeStyle = shade(agent.color, -0.18)
    ctx.lineWidth = this.screenPx(2.7)
    ctx.beginPath()
    ctx.moveTo(x - 9, y - 7)
    ctx.lineTo(x - 12, y + 4 + swing * 0.5)
    ctx.moveTo(x + 9, y - 7)
    ctx.lineTo(x + 12, y + 4 - swing * 0.5)
    ctx.stroke()

    const skin = SKIN_TONES[seed % SKIN_TONES.length]
    ctx.fillStyle = 'rgba(0,0,0,0.10)'
    ctx.fillRect(x - 2.5, y - 14, 5, 4)

    ctx.beginPath()
    ctx.arc(x, y - 20, 8.3, 0, Math.PI * 2)
    ctx.fillStyle = skin
    ctx.fill()
    ctx.strokeStyle = 'rgba(44, 30, 20, 0.22)'
    ctx.lineWidth = 0.7
    ctx.stroke()

    const hair = HAIR_COLORS[seed % HAIR_COLORS.length]
    ctx.beginPath()
    ctx.arc(x, y - 20.8, 8.4, Math.PI * 0.98, Math.PI * 2.02)
    ctx.fillStyle = hair
    ctx.fill()

    const facing = agent.facing === 0 ? 0 : agent.facing
    const blink = ((this.time + seed * 0.13) % 4.6) < 0.12
    ctx.fillStyle = '#3a2a20'
    if (agent.status === 'offline' || blink) {
      ctx.strokeStyle = '#3a2a20'
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.moveTo(x - 4.2 + facing * 1.2, y - 19.5)
      ctx.lineTo(x - 1.8 + facing * 1.2, y - 19.5)
      ctx.moveTo(x + 1.8 + facing * 1.2, y - 19.5)
      ctx.lineTo(x + 4.2 + facing * 1.2, y - 19.5)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x - 3.1 + facing * 1.3, y - 19.8, 0.95, 0, Math.PI * 2)
      ctx.arc(x + 3.1 + facing * 1.3, y - 19.8, 0.95, 0, Math.PI * 2)
      ctx.fill()
    }

    if (agent.status === 'blocked' && !agent.bubble) {
      const badgeY = y - this.screenPx(42)
      ctx.beginPath()
      ctx.arc(x, badgeY, this.screenPx(7.5), 0, Math.PI * 2)
      ctx.fillStyle = STATUS_META.blocked.color
      ctx.fill()
      ctx.font = `700 ${this.screenPx(9)}px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#1a1512'
      ctx.fillText('!', x, badgeY + 0.5)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
    }

    if (!agent.inElevator) {
      this.drawNameplate(agent, x, y, statusColor, isSelected)
      if (agent.bubble) this.drawBubble(agent, x, y)
    }

    ctx.restore()
  }

  private drawGroundStatus(
    agent: Agent,
    x: number,
    y: number,
    color: string,
    isSelected: boolean,
  ): void {
    const ctx = this.ctx
    const ringY = y + 18
    const progress = agent.task?.progress

    ctx.save()
    ctx.translate(x, ringY)
    ctx.scale(1, 0.42)

    ctx.beginPath()
    ctx.arc(0, 0, 20, 0, Math.PI * 2)
    ctx.strokeStyle = rgba(color, 0.22)
    ctx.lineWidth = this.screenPx(2)
    ctx.stroke()

    if (
      agent.status === 'working' &&
      typeof progress === 'number' &&
      progress > 0
    ) {
      ctx.beginPath()
      ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress) / 100)
      ctx.strokeStyle = color
      ctx.lineWidth = this.screenPx(2.4)
      ctx.lineCap = 'round'
      ctx.stroke()
    } else if (agent.status === 'working' && progress === null) {
      const pulse = 0.45 + Math.sin(this.time * 2.4 + hashString(agent.id)) * 0.2
      ctx.setLineDash([4 / this.camera.scale, 5 / this.camera.scale])
      ctx.beginPath()
      ctx.arc(0, 0, 20, 0, Math.PI * 2)
      ctx.strokeStyle = rgba(color, pulse)
      ctx.lineWidth = this.screenPx(1.8)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (isSelected) {
      ctx.setLineDash([5 / this.camera.scale, 4 / this.camera.scale])
      ctx.beginPath()
      ctx.arc(0, 0, 25, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(245, 231, 207, 0.85)'
      ctx.lineWidth = this.screenPx(1.4)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
  }

  private drawNameplate(
    agent: Agent,
    x: number,
    y: number,
    statusColor: string,
    isSelected: boolean,
  ): void {
    if (this.camera.scale < 0.34 && !isSelected && this.hoveredId !== agent.id) return

    const ctx = this.ctx
    const fontSize = this.screenPx(9.4)
    const paddingX = this.screenPx(7)
    const dotSize = this.screenPx(4.6)
    const height = this.screenPx(18)
    const gap = this.screenPx(4.5)
    const sourceDot = agent.source === 'hermes' ? this.screenPx(6) : 0

    ctx.font = `600 ${fontSize}px ${FONT_STACK}`
    const textWidth = ctx.measureText(agent.name).width
    const width = textWidth + paddingX * 2 + dotSize + gap + sourceDot
    const bx = x - width / 2
    const by = y + this.screenPx(18)

    roundedPath(ctx, bx, by, width, height, height / 2)
    ctx.fillStyle = 'rgba(14, 16, 19, 0.82)'
    ctx.fill()
    ctx.strokeStyle = isSelected ? rgba(agent.color, 0.75) : 'rgba(255,255,255,0.08)'
    ctx.lineWidth = isSelected ? 1.2 : 0.8
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(bx + paddingX + dotSize / 2, by + height / 2, dotSize / 2, 0, Math.PI * 2)
    ctx.fillStyle = statusColor
    ctx.fill()

    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${fontSize}px ${FONT_STACK}`
    ctx.fillStyle = '#efe6d6'
    ctx.fillText(agent.name, bx + paddingX + dotSize + gap, by + height / 2 + 0.5)

    if (agent.source === 'hermes') {
      ctx.fillStyle = PALETTE.brassSoft
      ctx.font = `600 ${this.screenPx(7)}px ${MONO_STACK}`
      ctx.fillText('H', bx + width - paddingX - this.screenPx(3), by + height / 2 + 0.5)
    }

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }

  private drawBubble(agent: Agent, x: number, y: number): void {
    if (!agent.bubble) return
    const ctx = this.ctx
    const remaining = agent.bubble.until - Date.now()
    if (remaining <= 0) return

    const alpha = clamp(remaining / 450, 0, 1)
    const fontSize = this.screenPx(10.4)
    const padding = this.screenPx(8)
    const lineHeight = fontSize * 1.28
    const maxWidth = this.screenPx(170)

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `500 ${fontSize}px ${FONT_STACK}`
    const lines = wrapText(ctx, agent.bubble.text, maxWidth - padding * 2, 2)
    let contentWidth = 0
    for (const line of lines) contentWidth = Math.max(contentWidth, ctx.measureText(line).width)
    const width = Math.max(this.screenPx(42), contentWidth + padding * 2)
    const height = lines.length * lineHeight + padding * 2
    const bx = x - width / 2
    const by = y - this.screenPx(48) - height

    roundedPath(ctx, bx, by, width, height, this.screenPx(8))
    ctx.fillStyle = '#f5eddf'
    ctx.fill()
    ctx.strokeStyle = 'rgba(60, 43, 25, 0.22)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(x - this.screenPx(5), by + height - 1)
    ctx.lineTo(x, by + height + this.screenPx(7))
    ctx.lineTo(x + this.screenPx(5), by + height - 1)
    ctx.closePath()
    ctx.fillStyle = '#f5eddf'
    ctx.fill()

    ctx.fillStyle = '#2b241b'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((line, index) => {
      ctx.fillText(line, x, by + padding + lineHeight * (index + 0.5))
    })

    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.restore()
  }
}

function drawWindowBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.save()
  ctx.fillStyle = PALETTE.window
  let cursor = x
  while (cursor < x + width) {
    const segment = 46
    ctx.fillRect(cursor, y, Math.min(segment, x + width - cursor), height)
    ctx.fillStyle = PALETTE.windowGlow
    ctx.fillRect(cursor, y, Math.min(segment, x + width - cursor), height / 2)
    ctx.fillStyle = PALETTE.window
    cursor += segment + 14
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(x, y + height - 1, width, 1)
  ctx.restore()
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  floor: OfficeLayout['floors'][number],
  top: number,
): void {
  const rug = FLOOR_RUGS[floor.number] ?? PALETTE.rugSage
  roundedPath(ctx, 150, top + 197, 640, 42, 9)
  ctx.fillStyle = rug
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.10)'
  ctx.beginPath()
  ctx.moveTo(162, top + 205)
  ctx.lineTo(778, top + 205)
  ctx.moveTo(162, top + 231)
  ctx.lineTo(778, top + 231)
  ctx.stroke()
}

function drawPlant(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  seed: number,
  screenPx: (pixels: number) => number,
): void {
  const random = mulberry32(Math.floor(seed * 1000) + 7)
  ctx.save()
  ctx.translate(x, y)

  ctx.beginPath()
  ctx.ellipse(0, 2, 12, 4, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(30, 22, 14, 0.18)'
  ctx.fill()

  const leaves = 6
  for (let index = 0; index < leaves; index += 1) {
    const angle = -Math.PI / 2 + (index - (leaves - 1) / 2) * 0.34 + (random() - 0.5) * 0.12
    const length = 15 + random() * 9
    ctx.save()
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(0, -length * 0.55, length * 0.24, length * 0.58, 0, 0, Math.PI * 2)
    ctx.fillStyle = index % 3 === 0 ? PALETTE.plantLight : index % 3 === 1 ? PALETTE.plant : PALETTE.plantDark
    ctx.fill()
    ctx.restore()
  }

  roundedPath(ctx, -8, -3, 16, 11, 3)
  ctx.fillStyle = PALETTE.pot
  ctx.fill()
  ctx.strokeStyle = 'rgba(50, 34, 20, 0.25)'
  ctx.lineWidth = 0.8
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.fillRect(-8, -3, 16, 1.5)

  ctx.restore()
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  floor: OfficeLayout['floors'][number],
  desk: OfficeLayout['floors'][number]['desks'][number],
  occupant: Agent | undefined,
  time: number,
): void {
  const width = 130
  const height = 62
  const x = desk.x
  const y = desk.y
  const working = occupant?.status === 'working'
  const blocked = occupant?.status === 'blocked'

  const chairX = desk.seat.x
  const chairY = desk.row === 'top' ? desk.seat.y + 12 : desk.seat.y - 12
  roundedPath(ctx, chairX - 13, chairY - 8, 26, 17, 6)
  ctx.fillStyle = PALETTE.chairDark
  ctx.fill()
  roundedPath(ctx, chairX - 10, chairY - 5, 20, 11, 4)
  ctx.fillStyle = PALETTE.chair
  ctx.fill()

  ctx.save()
  ctx.fillStyle = PALETTE.deskShadow
  roundedPath(ctx, x + 3, y + 5, width, height, 5)
  ctx.fill()
  ctx.restore()

  const gradient = ctx.createLinearGradient(x, y, x + width, y + height)
  gradient.addColorStop(0, PALETTE.desk)
  gradient.addColorStop(1, PALETTE.deskDark)
  roundedPath(ctx, x, y, width, height, 5)
  ctx.fillStyle = gradient
  ctx.fill()
  ctx.strokeStyle = PALETTE.deskEdge
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.fillRect(x + 4, y + 3, width - 8, 1)

  const monitorX = x + width / 2
  const monitorY = desk.row === 'top' ? y + 18 : y + height - 18

  ctx.fillStyle = '#b9a482'
  ctx.fillRect(monitorX - 3, monitorY + 6, 6, 5)
  ctx.fillRect(monitorX - 10, monitorY + 11, 20, 2.5)

  if (working || blocked) {
    ctx.fillStyle = blocked ? 'rgba(224, 108, 94, 0.12)' : 'rgba(123, 216, 176, 0.13)'
    roundedPath(ctx, monitorX - 27, monitorY - 17, 54, 34, 6)
    ctx.fill()

    roundedPath(ctx, monitorX - 22, monitorY - 12, 44, 24, 3)
    ctx.fillStyle = blocked ? '#6e3733' : '#24564e'
    ctx.fill()

    ctx.fillStyle = blocked ? 'rgba(232, 161, 154, 0.8)' : 'rgba(143, 230, 200, 0.85)'
    ctx.fillRect(monitorX - 17, monitorY - 6, 24, 1.6)
    ctx.fillRect(monitorX - 17, monitorY - 2, 30, 1.6)
    ctx.fillRect(monitorX - 17, monitorY + 2, 18, 1.6)
  } else {
    roundedPath(ctx, monitorX - 22, monitorY - 12, 44, 24, 3)
    ctx.fillStyle = PALETTE.monitor
    ctx.fill()
    ctx.strokeStyle = PALETTE.monitorEdge
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(monitorX - 18, monitorY - 8, 36, 1)
  }

  const keyboardY = desk.row === 'top' ? y + height - 16 : y + 8
  roundedPath(ctx, monitorX - 15, keyboardY, 30, 8, 2)
  ctx.fillStyle = '#cfc0a6'
  ctx.fill()
  ctx.strokeStyle = 'rgba(90, 70, 45, 0.22)'
  ctx.stroke()
  for (let row = 0; row < 2; row += 1) {
    ctx.fillStyle = 'rgba(90, 70, 45, 0.16)'
    for (let key = 0; key < 7; key += 1) {
      ctx.fillRect(monitorX - 12 + key * 3.6, keyboardY + 2 + row * 2.4, 2.4, 1.4)
    }
  }

  roundedPath(ctx, x + 13, y + 13, 13, 17, 2)
  ctx.fillStyle = PALETTE.paper
  ctx.fill()
  ctx.strokeStyle = PALETTE.paperEdge
  ctx.lineWidth = 0.6
  ctx.stroke()
  ctx.fillStyle = 'rgba(90, 70, 45, 0.22)'
  for (let line = 0; line < 3; line += 1) {
    ctx.fillRect(x + 16, y + 18 + line * 3, 7, 0.8)
  }

  roundedPath(ctx, x + width - 28, y + height - 22, 9, 11, 2)
  ctx.fillStyle = occupant ? shade(occupant.color, -0.12) : '#d8c8ad'
  ctx.fill()
  ctx.strokeStyle = 'rgba(60, 40, 20, 0.25)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x + width - 18, y + height - 17, 4.5, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(60, 40, 20, 0.3)'
  ctx.lineWidth = 1
  ctx.stroke()

  const pulse = 0.5 + Math.sin(time * 3 + x) * 0.5
  if (working) {
    ctx.beginPath()
    ctx.arc(x + width - 46, y + 12, 1.6, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(123, 216, 176, ${0.35 + pulse * 0.5})`
    ctx.fill()
  }
}
