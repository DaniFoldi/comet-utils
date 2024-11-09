export function nullToString(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return ''
}
