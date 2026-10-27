import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resource = path.join(root, 'resources/local-input')
const manifest = JSON.parse((await fs.readFile(path.join(resource, 'manifest.json'), 'utf8')).replace(/^\uFEFF/, ''))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function directory(name, rule) {
  const destination = path.join(resource, name)
  await fs.mkdir(destination, { recursive: true })
  try { await fs.writeFile(path.join(destination, 'AGENTS.md'), `# Generated ${name} assets\n- ${rule}\n- Keep previous files. No user data or raw device recordings.\n`, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  return destination
}
async function download(entry, destination) {
  try {
    const bytes = await fs.readFile(destination)
    if (bytes.length === entry.bytes && sha(bytes) === entry.sha256) return
    throw new Error(`Existing pinned asset differs: ${path.basename(destination)}. Preserve it and review before changing the pin.`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const response = await fetch(entry.url, { signal: AbortSignal.timeout(240000) })
  if (!response.ok || !response.body) throw new Error(`Official download failed: HTTP ${response.status}`)
  const part = `${destination}.${randomUUID()}.part`
  const handle = await fs.open(part, 'wx'); const hash = createHash('sha256'); let length = 0
  try { for await (const bytes of response.body) { length += bytes.length; if (length > entry.bytes) throw new Error('Pinned asset is too large.'); hash.update(bytes); await handle.write(bytes) } } finally { await handle.close() }
  if (length !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new Error('Pinned asset hash/size mismatch; retained part for diagnosis.')
  await fs.copyFile(part, destination, 1)
  console.log(`Verified ${path.basename(destination)} (${length} bytes)`)
}
const downloads = await directory('downloads', 'Pinned downloaded archives and retained partial downloads; exclude from source/program archives.')
const whisper = await directory('whisper', 'Only official pinned Windows x64 whisper-cli.exe and its DLL dependencies; program artifact only.')
const vision = await directory('vision', 'Pinned hand-landmark model, plus local project dependency WASM under wasm/. Program artifact only.')
const wasm = await directory('vision/wasm', 'Copied from @mediapipe/tasks-vision 0.10.32; SHA-256 recorded in prepared.json.')
const licenses = await directory('licenses', 'Upstream redistributable licenses; include in both source/program archives.')
const archive = path.join(downloads, 'whisper-v1.8.4-x64.zip')
await download(manifest.runner, archive)
const extract = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead($env:PAPER_INPUT_ARCHIVE); try { foreach ($entry in $zip.Entries) { $name = [IO.Path]::GetFileName($entry.FullName); if ($name -eq 'whisper-cli.exe' -or $name -match '^[A-Za-z0-9_.-]+\\.dll$') { $target = Join-Path $env:PAPER_INPUT_RUNNER $name; if (Test-Path -LiteralPath $target) { $inputStream = $entry.Open(); $hasher = [Security.Cryptography.SHA256]::Create(); try { $expected = [BitConverter]::ToString($hasher.ComputeHash($inputStream)).Replace('-', ''); $actual = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($target))).Replace('-', ''); if ($expected -ne $actual) { throw 'Existing native asset differs from pinned archive.' } } finally { $inputStream.Dispose(); $hasher.Dispose() } } else { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false) } } } } finally { $zip.Dispose() }`], { windowsHide: true, env: { ...process.env, PAPER_INPUT_ARCHIVE: archive, PAPER_INPUT_RUNNER: whisper }, encoding: 'utf8' })
if (extract.status !== 0) throw new Error(`Pinned native extraction failed: ${extract.stderr}`)
await fs.access(path.join(whisper, 'whisper-cli.exe'))
await download(manifest.handModel, path.join(vision, 'hand_landmarker.task'))
const dependency = path.join(root, 'node_modules/@mediapipe/tasks-vision')
const version = JSON.parse(await fs.readFile(path.join(dependency, 'package.json'), 'utf8')).version
if (version !== '0.10.32') throw new Error(`Expected tasks-vision 0.10.32, got ${version}; review asset pin.`)
for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) await fs.copyFile(path.join(dependency, 'wasm', name), path.join(wasm, name))
for (const [name, url] of [['whisper-MIT.txt', 'https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.4/LICENSE'], ['whisper-model-MIT.txt', 'https://raw.githubusercontent.com/openai/whisper/v20240930/LICENSE'], ['mediapipe-Apache-2.0.txt', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.32/LICENSE']]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Upstream license unavailable: ${name}`)
  const text = await response.text()
  if (text.length < 500 || text.length > 20000) throw new Error('Unexpected upstream license.')
  await fs.writeFile(path.join(licenses, name), text)
}
if (process.argv.includes('--with-model')) { const models = await directory('models', 'Development-only pinned speech-model smoke-test cache. Exclude all files from program/source archives.'); await download(manifest.model, path.join(models, 'ggml-base-60ed5bc3.bin')) }
const records = []
for (const directory of [whisper, vision, wasm, licenses]) for (const name of await fs.readdir(directory)) {
  const file = path.join(directory, name); const stat = await fs.stat(file)
  if (!stat.isFile() || name === 'AGENTS.md' || name.endsWith('.part')) continue
  const bytes = await fs.readFile(file)
  records.push({ path: path.relative(resource, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) })
}
await fs.writeFile(path.join(resource, 'prepared.json'), JSON.stringify({ schemaVersion: 1, runner: manifest.runner.version, tasksVision: version, files: records }, null, 2) + '\n')
console.log(`Prepared ${records.length} local inference assets; speech model remains an explicit app download/import.`)


