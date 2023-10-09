export function randomName(): string {
  return Math.random().toString(36).slice(2).toLowerCase()
}
