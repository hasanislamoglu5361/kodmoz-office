export function foregroundFor(hex: string): string {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value
  const number = Number.parseInt(full, 16)
  const r = (number >> 16) & 255
  const g = (number >> 8) & 255
  const b = number & 255
  const yiq = (r * 299 + g * 587 + b * 114) / 1000
  return yiq >= 150 ? '#1d1913' : '#fff8ec'
}
