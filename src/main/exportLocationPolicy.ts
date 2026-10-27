import { lstat, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function within(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate))
  return !path || !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}
function absoluteRoot(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 32760 || value.includes('\0') || !isAbsolute(value)) throw new Error('Invalid protected export root configuration: absolute directory paths are required')
  return resolve(value)
}
async function canonicalRoot(root: string): Promise<string> {
  let current = root
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (!(await lstat(canonical)).isDirectory()) throw new Error('Protected root is not a directory')
      return resolve(canonical, ...missing)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Protected export root configuration cannot be verified')
      try {
        await lstat(current)
        throw new Error('Protected export root configuration contains an unresolved symbolic link')
      } catch (linkError) {
        if ((linkError as NodeJS.ErrnoException).code !== 'ENOENT') throw linkError
      }
      const parent = dirname(current)
      if (parent === current) return root
      missing.unshift(basename(current))
      current = parent
    }
  }
}

export async function assertExportLocation(destination: string, protectedRoots: string[]): Promise<void> {
  if (!Array.isArray(protectedRoots) || !protectedRoots.length || protectedRoots.length > 20000) throw new Error('Invalid protected export root configuration')
  const roots = protectedRoots.map(absoluteRoot)
  if (typeof destination !== 'string' || !destination || destination.length > 32760 || destination.includes('\0') || !isAbsolute(destination) || /[\\/]$/.test(destination)) throw new Error('Choose an absolute export file destination in an existing parent folder')
  const normalized = resolve(destination), name = basename(normalized)
  if (!name || name === '.' || name === '..' || /[<>:"|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('Invalid export destination file name')
  let parent: string
  try {
    parent = await realpath(dirname(normalized))
    if (!(await lstat(parent)).isDirectory()) throw new Error('Invalid export parent')
  } catch { throw new Error('Choose an existing export parent folder; no output directory was created') }
  const actual = resolve(parent, name)
  for (const root of roots) {
    const canonical = await canonicalRoot(root)
    if (within(root, normalized) || within(root, actual) || within(canonical, normalized) || within(canonical, actual)) throw new Error('Choose an export location outside internal application data and all current or historical managed PDF directories')
  }
}