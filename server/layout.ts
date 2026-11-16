import type { Desk, Floor, OfficeLayout, Point } from '../shared/types'

export const FLOOR_HEIGHT = 430
export const FLOOR_GAP = 34
export const BUILDING_WIDTH = 1240

const DESK_WIDTH = 130
const DESK_HEIGHT = 62
const DESK_XS = [240, 460, 680]
const TOP_ROW_Y = 64
const BOTTOM_ROW_Y = 310
const CORRIDOR_Y = 218

export const ELEVATOR_WAIT: Point = { x: 1096, y: CORRIDOR_Y }
export const ELEVATOR_CAB: Point = { x: 1180, y: CORRIDOR_Y }
export const COFFEE_POINT: Point = { x: 930, y: 158 }
export const LOUNGE_POINT: Point = { x: 940, y: 332 }
export const CORRIDOR: Point = { x: 0, y: CORRIDOR_Y }

export interface FloorDefinition {
  number: number
  name: string
  subtitle: string
}

/** Slot order groups desks by row; the first three are the top row. */
const SLOT_ORDER = [0, 3, 1, 4, 2, 5]

export function slotOrder(index: number): number {
  return SLOT_ORDER[index % SLOT_ORDER.length] ?? 0
}

export function floorTopFor(sortedIndex: number): number {
  return sortedIndex * (FLOOR_HEIGHT + FLOOR_GAP)
}

export function buildLayout(definitions: FloorDefinition[]): OfficeLayout {
  const sorted = [...definitions].sort((a, b) => b.number - a.number)
  const floors: Floor[] = sorted.map((definition, index) => {
    const top = floorTopFor(index)
    const desks: Desk[] = []

    for (const row of ['top', 'bottom'] as const) {
      DESK_XS.forEach((x, deskIndex) => {
        const y = row === 'top' ? TOP_ROW_Y : BOTTOM_ROW_Y
        const seatY = row === 'top' ? TOP_ROW_Y + DESK_HEIGHT + 24 : BOTTOM_ROW_Y - 24
        desks.push({
          id: `${definition.number}-${row}-${deskIndex}`,
          floor: definition.number,
          x,
          y,
          row,
          seat: { x: x + DESK_WIDTH / 2, y: seatY },
          visit: { x: x + DESK_WIDTH - 12, y: seatY },
          agentId: null,
        })
      })
    }

    return {
      number: definition.number,
      name: definition.name,
      subtitle: definition.subtitle,
      top,
      desks,
      coffee: { ...COFFEE_POINT },
      lounge: { ...LOUNGE_POINT },
      elevator: {
        wait: { ...ELEVATOR_WAIT },
        cab: { ...ELEVATOR_CAB },
      },
    }
  })

  const height = sorted.length * FLOOR_HEIGHT + Math.max(0, sorted.length - 1) * FLOOR_GAP

  return {
    width: BUILDING_WIDTH,
    height,
    floorHeight: FLOOR_HEIGHT,
    floorGap: FLOOR_GAP,
    floors,
    shaft: {
      x: 1138,
      y: 0,
      width: 82,
      height,
      centerX: 1180,
    },
  }
}

export function floorTopNumber(layout: OfficeLayout, floorNumber: number): number {
  const floor = layout.floors.find((candidate) => candidate.number === floorNumber)
  return floor?.top ?? 0
}

export { CORRIDOR_Y, DESK_WIDTH, DESK_HEIGHT }
