import test from 'node:test'
import assert from 'node:assert/strict'
const modulePromise = import('./evidenceDrag').catch(() => null)
function transfer() { const data = new Map<string, string>(); return { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '', clearData: () => data.clear(), effectAllowed: 'none', get types() { return [...data.keys()] } } as unknown as DataTransfer }
const payload = { paperId: 'paper-a', entryId: 'figure-a', assetId: '00000000-0000-4000-8000-000000000001', page: 3, rect: { x: .1, y: .2, width: .3, height: .4 } }
test('internal evidence drag exposes only a one-use opaque token and protects the source snapshot', async () => {
  const module = await modulePromise; assert.ok(module, 'Internal drag registry is missing')
  const data = transfer(), mutable = structuredClone(payload); module.beginEvidenceDrag(data, mutable); mutable.rect.x = .9
  assert.deepEqual(data.types, [module.EVIDENCE_DRAG_MIME])
  assert.doesNotMatch(data.getData(module.EVIDENCE_DRAG_MIME), /paper-a|figure-a|assetId|page|rect/)
  const first = module.readEvidenceDrag(data, 'paper-a'); assert.deepEqual(first, payload)
  assert.equal(module.readEvidenceDrag(data, 'paper-a'), null)
})
test('forged, cross-paper and ended evidence drags cannot insert assets', async () => {
  const module = await modulePromise; assert.ok(module)
  const data = transfer(); data.setData(module.EVIDENCE_DRAG_MIME, JSON.stringify(payload)); assert.equal(module.readEvidenceDrag(data, 'paper-a'), null)
  module.beginEvidenceDrag(data, payload); assert.equal(module.readEvidenceDrag(data, 'paper-b'), null)
  module.endEvidenceDrag(); assert.equal(module.readEvidenceDrag(data, 'paper-a'), null)
})
test('expired evidence token refuses stale drops and invalid source geometry refuses registration', async () => {
  const module = await modulePromise; assert.ok(module)
  const data = transfer(), now = Date.now; let time = 1000
  Date.now = () => time
  try { module.beginEvidenceDrag(data, payload); time += 120001; assert.equal(module.readEvidenceDrag(data, 'paper-a'), null) } finally { Date.now = now; module.endEvidenceDrag() }
  assert.throws(() => module.beginEvidenceDrag(data, { ...payload, rect: { ...payload.rect, x: -1 } }), /source|rect|geometry|drag/i)
})

test('starting a second drag revokes the first token without mixing source assets', async () => {
  const module = await modulePromise; assert.ok(module)
  const first = transfer(), second = transfer()
  module.beginEvidenceDrag(first, payload)
  module.beginEvidenceDrag(second, { ...payload, entryId: 'table-b', assetId: '00000000-0000-4000-8000-000000000002' })
  assert.equal(module.readEvidenceDrag(first, 'paper-a'), null)
  assert.equal(module.readEvidenceDrag(second, 'paper-a')!.entryId, 'table-b')
})
