import { access } from 'node:fs/promises'


export async function fileExists(path: Parameters<typeof access>[0]): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
