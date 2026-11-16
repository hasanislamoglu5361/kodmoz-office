interface IconProps {
  size?: number
  className?: string
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function PauseIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M9 5v14M15 5v14" strokeWidth={2.4} />
    </svg>
  )
}

export function PlayIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M8 5.5v13l10-6.5-10-6.5Z" />
    </svg>
  )
}

export function FitIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
      <rect {...base} x="9" y="9" width="6" height="6" rx="1" opacity=".55" />
    </svg>
  )
}

export function PanelIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect {...base} x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path {...base} d="M14.5 4.5v15" />
      <path {...base} d="M17.5 8h1M17.5 11h1" opacity=".7" />
    </svg>
  )
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function FocusIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle {...base} cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <path {...base} d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}

export function SendIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="m4 11 16-7-7 16-2.5-6.5L4 11Z" />
      <path {...base} d="M10.5 13.5 20 4" opacity=".6" />
    </svg>
  )
}

export function SparkIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  )
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="m5 12.5 4.5 4.5L19 7" strokeWidth={2.1} />
    </svg>
  )
}

export function AlertIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path {...base} d="M12 4 3.5 19h17L12 4Z" />
      <path {...base} d="M12 9.5v4" />
      <circle cx="12" cy="16.4" r=".9" fill="currentColor" />
    </svg>
  )
}
