import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Agent, ElevatorState, OfficeLayout } from '../../shared/types'
import { OfficeRenderer } from './renderer'
import { STATUS_META, relativeTime } from '../lib/status'

export interface OfficeCanvasHandle {
  fit: () => void
  focusAgent: (agentId: string) => void
  focusFloor: (floor: number) => void
}

interface OfficeCanvasProps {
  layout: OfficeLayout
  agents: Agent[]
  elevator: ElevatorState
  selectedId: string | null
  onSelectAgent: (agentId: string | null) => void
  onSelectFloor: (floor: number) => void
}

interface HoverState {
  agentId: string
  x: number
  y: number
}

interface DragState {
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

export const OfficeCanvas = forwardRef<OfficeCanvasHandle, OfficeCanvasProps>(
  function OfficeCanvas(
    { layout, agents, elevator, selectedId, onSelectAgent, onSelectFloor },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const rendererRef = useRef<OfficeRenderer | null>(null)
    const layoutRef = useRef(layout)
    const [hover, setHover] = useState<HoverState | null>(null)
    const pointersRef = useRef(new Map<number, { x: number; y: number }>())
    const dragRef = useRef<DragState | null>(null)
    const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null)
    const lastHoverAtRef = useRef(0)

    layoutRef.current = layout

    useImperativeHandle(ref, () => ({
      fit: () => rendererRef.current?.fit(true),
      focusAgent: (agentId: string) => rendererRef.current?.focusAgent(agentId, true),
      focusFloor: (floor: number) => rendererRef.current?.focusFloor(floor, true),
    }))

    useEffect(() => {
      const container = containerRef.current
      const canvas = canvasRef.current
      if (!container || !canvas) return

      const renderer = new OfficeRenderer(canvas, layoutRef.current)
      rendererRef.current = renderer

      const resize = () => {
        const rect = container.getBoundingClientRect()
        renderer.setViewport(
          rect.width,
          rect.height,
          Math.min(window.devicePixelRatio || 1, 1.5),
          rect.width < 720,
        )
      }

      resize()
      const observer = new ResizeObserver(resize)
      observer.observe(container)
      requestAnimationFrame(() => {
        resize()
        renderer.fit(false)
      })

      let frame = 0
      let last = performance.now()
      let accumulated = 0
      const loop = (timestamp: number) => {
        const delta = timestamp - last
        last = timestamp
        accumulated += delta
        if (accumulated >= 30) {
          renderer.render(accumulated)
          accumulated = 0
        }
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)

      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        rendererRef.current = null
      }
    }, [])

    useEffect(() => {
      rendererRef.current?.setLayout(layout)
    }, [layout])

    useEffect(() => {
      rendererRef.current?.setData(agents, elevator, selectedId, hover?.agentId ?? null)
    }, [hover, agents, elevator, selectedId])

    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const onWheel = (event: WheelEvent) => {
        event.preventDefault()
        const renderer = rendererRef.current
        if (!renderer) return
        const rect = container.getBoundingClientRect()
        renderer.zoomAt(
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(-event.deltaY * 0.0014),
        )
      }
      container.addEventListener('wheel', onWheel, { passive: false })
      return () => container.removeEventListener('wheel', onWheel)
    }, [])

    const hitAt = (clientX: number, clientY: number) => {
      const container = containerRef.current
      const renderer = rendererRef.current
      if (!container || !renderer) return null
      const rect = container.getBoundingClientRect()
      return { hit: renderer.hitTest(clientX - rect.left, clientY - rect.top), rect }
    }

    const updateHover = (clientX: number, clientY: number) => {
      const now = performance.now()
      if (now - lastHoverAtRef.current < 40) return
      lastHoverAtRef.current = now
      const result = hitAt(clientX, clientY)
      if (!result) return
      const container = containerRef.current
      if (!container) return
      const rect = result.rect

      const hit = result.hit
      if (hit?.kind === 'agent') {
        const agent = agents.find((candidate) => candidate.id === hit.id)
        if (agent) {
          const localX = clientX - rect.left
          const localY = clientY - rect.top
          setHover({ agentId: agent.id, x: localX, y: localY })
          container.style.cursor = 'pointer'
          return
        }
      }

      setHover(null)
      container.style.cursor = hit?.kind === 'floor' ? 'pointer' : 'grab'
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container) return
      container.setPointerCapture(event.pointerId)
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointersRef.current.size === 1) {
        dragRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
        }
        container.style.cursor = 'grabbing'
        setHover(null)
      } else if (pointersRef.current.size === 2) {
        const points = [...pointersRef.current.values()]
        pinchRef.current = {
          distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
          midX: (points[0].x + points[1].x) / 2,
          midY: (points[0].y + points[1].y) / 2,
        }
        if (dragRef.current) dragRef.current.moved = true
      }
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      if (!container) return
      const previous = pointersRef.current.get(event.pointerId)
      if (!previous) {
        updateHover(event.clientX, event.clientY)
        return
      }
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

      if (pointersRef.current.size === 2 && pinchRef.current) {
        const points = [...pointersRef.current.values()]
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
        const midX = (points[0].x + points[1].x) / 2
        const midY = (points[0].y + points[1].y) / 2
        const renderer = rendererRef.current
        const rect = container.getBoundingClientRect()
        if (renderer && pinchRef.current.distance > 0) {
          renderer.panBy(midX - pinchRef.current.midX, midY - pinchRef.current.midY)
          renderer.zoomAt(
            midX - rect.left,
            midY - rect.top,
            distance / pinchRef.current.distance,
          )
        }
        pinchRef.current = { distance, midX, midY }
        return
      }

      const drag = dragRef.current
      if (!drag) {
        updateHover(event.clientX, event.clientY)
        return
      }

      const totalDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (!drag.moved && totalDistance > 4) drag.moved = true

      if (drag.moved) {
        rendererRef.current?.panBy(event.clientX - drag.lastX, event.clientY - drag.lastY)
        drag.lastX = event.clientX
        drag.lastY = event.clientY
        setHover(null)
      }
    }

    const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current
      const drag = dragRef.current
      pointersRef.current.delete(event.pointerId)

      if (pointersRef.current.size < 2) pinchRef.current = null

      if (drag && !drag.moved && pointersRef.current.size === 0) {
        const result = hitAt(event.clientX, event.clientY)
        if (result?.hit?.kind === 'agent') {
          onSelectAgent(result.hit.id)
        } else if (result?.hit?.kind === 'floor') {
          onSelectFloor(result.hit.floor)
        } else {
          onSelectAgent(null)
        }
      }

      if (pointersRef.current.size === 0) {
        dragRef.current = null
        if (container) container.style.cursor = 'grab'
      } else if (pointersRef.current.size === 1) {
        const remaining = [...pointersRef.current.values()][0]
        dragRef.current = {
          startX: remaining.x,
          startY: remaining.y,
          lastX: remaining.x,
          lastY: remaining.y,
          moved: true,
        }
      }
    }

    const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      const result = hitAt(event.clientX, event.clientY)
      if (result?.hit?.kind === 'agent') {
        rendererRef.current?.focusAgent(result.hit.id, true)
      } else if (result?.hit?.kind === 'floor') {
        rendererRef.current?.focusFloor(result.hit.floor, true)
      }
    }

    const hoveredAgent = hover ? agents.find((agent) => agent.id === hover.agentId) : null

    return (
      <div
        ref={containerRef}
        className="scene"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (pointersRef.current.size === 0) setHover(null)
        }}
        onDoubleClick={handleDoubleClick}
      >
        <canvas ref={canvasRef} className="scene-canvas" />

        {hoveredAgent && hover && (
          <div
            className="agent-tooltip"
            style={{
              left: Math.max(
                8,
                Math.min(hover.x + 16, (containerRef.current?.clientWidth ?? 600) - 230),
              ),
              top: Math.max(
                8,
                Math.min(hover.y + 16, (containerRef.current?.clientHeight ?? 400) - 120),
              ),
            }}
          >
            <div className="agent-tooltip-head">
              <span
                className="agent-tooltip-dot"
                style={{ background: STATUS_META[hoveredAgent.status].color }}
              />
              <strong>{hoveredAgent.name}</strong>
              <span>{hoveredAgent.role}</span>
            </div>
            <div className="agent-tooltip-status">
              {STATUS_META[hoveredAgent.status].label}
              <span>· K{hoveredAgent.floor}</span>
              <span>· {relativeTime(hoveredAgent.lastActive)}</span>
            </div>
            {hoveredAgent.task ? (
              <div className="agent-tooltip-task">{hoveredAgent.task.title}</div>
            ) : (
              <div className="agent-tooltip-task muted">
                {hoveredAgent.activity || 'Şu an bir görev yok'}
              </div>
            )}
          </div>
        )}

        <div className="scene-legend">
          {(['working', 'idle', 'delegating', 'coffee'] as const).map((status) => (
            <span key={status}>
              <i style={{ background: STATUS_META[status].color }} />
              {STATUS_META[status].label}
            </span>
          ))}
        </div>

        <div className="scene-hint">Sürükle · Tekerlek · Ajana tıkla</div>
      </div>
    )
  },
)
