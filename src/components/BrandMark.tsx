interface BrandMarkProps {
  size?: number
  className?: string
}

export function BrandMark({ size = 34, className }: BrandMarkProps) {
  return (
    <svg
      className={`brand-mark ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <rect x="3" y="19" width="30" height="12" rx="3" fill="#b99e78" />
      <rect x="3" y="7" width="30" height="12" rx="3" fill="#d7c3a1" />
      <rect x="7" y="23.5" width="5" height="5" rx="1.2" fill="#7bd8b0" />
      <rect x="15.5" y="23.5" width="5" height="5" rx="1.2" fill="#e8b45a" />
      <rect x="24" y="23.5" width="5" height="5" rx="1.2" fill="#c79bff" />
      <rect x="7" y="11.5" width="5" height="5" rx="1.2" fill="#6fb3ff" />
      <rect x="15.5" y="11.5" width="5" height="5" rx="1.2" fill="#f08a5d" />
      <rect x="24" y="11.5" width="5" height="5" rx="1.2" fill="#f472b6" />
    </svg>
  )
}
