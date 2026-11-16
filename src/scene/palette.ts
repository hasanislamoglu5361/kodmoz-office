export const PALETTE = {
  bgTop: '#0a0c0f',
  bgBottom: '#11151a',
  grid: 'rgba(235, 225, 205, 0.055)',
  glow: 'rgba(232, 180, 90, 0.07)',

  slab: '#39322b',
  slabDark: '#241f1b',
  slabLight: '#4b4239',
  floorLight: '#d3bd99',
  floorDark: '#bda57f',
  plank: 'rgba(83, 61, 35, 0.10)',
  plankDark: 'rgba(64, 46, 27, 0.13)',
  wall: '#3a332c',
  window: 'rgba(150, 190, 205, 0.20)',
  windowGlow: 'rgba(190, 220, 228, 0.10)',

  desk: '#e7d8bc',
  deskDark: '#d5c1a0',
  deskEdge: '#b0966f',
  deskShadow: 'rgba(31, 22, 13, 0.22)',
  chair: '#705c47',
  chairDark: '#5a4938',
  monitor: '#20252a',
  monitorEdge: '#343b41',
  monitorGlow: '#7bd8b0',

  coffee: '#8d6a4c',
  coffeeDark: '#6d4f38',
  paper: '#f1e7d4',
  paperEdge: '#d8c9ae',
  plant: '#5f7f58',
  plantLight: '#79956c',
  plantDark: '#476143',
  pot: '#8d6f52',
  rugTerracotta: 'rgba(168, 92, 72, 0.20)',
  rugSage: 'rgba(103, 124, 94, 0.22)',
  rugSlate: 'rgba(78, 105, 128, 0.20)',

  text: '#f2eadc',
  muted: '#a89a83',
  brass: '#e8b45a',
  brassSoft: 'rgba(232, 180, 90, 0.38)',
  darkLabel: 'rgba(17, 15, 13, 0.62)',
  glass: 'rgba(160, 195, 205, 0.055)',
  glassEdge: 'rgba(220, 235, 240, 0.14)',
  shadow: 'rgba(6, 6, 7, 0.42)',
}

export const SKIN_TONES = ['#e9c5a0', '#dcaa7f', '#c88f62', '#a96f49', '#8a5839', '#f0d2b3']
export const HAIR_COLORS = ['#2b211b', '#3c2a1e', '#1e1a17', '#5a3d28', '#6f4d32', '#241b16']

export const FLOOR_RUGS: Record<number, string> = {
  3: PALETTE.rugTerracotta,
  2: PALETTE.rugSage,
  1: PALETTE.rugSlate,
}

export const FLOOR_TINTS: Record<number, string> = {
  3: '#d7c19c',
  2: '#d2bd99',
  1: '#cbb592',
}
