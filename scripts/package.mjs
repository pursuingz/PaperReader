import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This local packaging command targets Windows x64. Run it on that platform.')
}
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
const destination = join(project, 'dist', `PaperReader-${manifest.version}-win32-x64`)
const runtime = join(project, 'node_modules', 'electron', 'dist')
const app = join(destination, 'resources', 'app')

// Only copy generated/runtime files. No removal, source, cache, or user data.
await mkdir(destination, { recursive: true })
await cp(runtime, destination, { recursive: true })
await mkdir(app, { recursive: true })
await cp(join(project, 'out'), join(app, 'out'), { recursive: true })
await writeFile(join(app, 'package.json'), JSON.stringify({
  name: 'paper-reader',
  productName: 'Paper Reader',
  version: manifest.version,
  main: 'out/main/index.js'
}, null, 2))
await copyFile(join(runtime, 'electron.exe'), join(destination, 'PaperReader.exe'))
await writeFile(join(destination, 'README.txt'),
  'Paper Reader - Windows desktop preview\r\n\r\nRun PaperReader.exe. Keep the whole directory together.\r\nPDFs and notes are stored in your local application data directory.\r\nAdd your own DeepSeek API key in Settings to enable AI.\r\nBundled demo content is explicitly labelled and is not an AI response.\r\n')
console.log(`Portable application: ${destination}`)
