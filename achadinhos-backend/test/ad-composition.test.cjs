const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
require('reflect-metadata')
const root = mkdtempSync(path.join(tmpdir(), 'ad-composition-'))
process.env.AD_MEDIA_DIR = root
process.env.AD_STORAGE_DRIVER = 'local'
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test'
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-characters'
const { AdProjectConfigSchema, AdOverlaySchema } = require('../dist/dtos/adProject.js')
const { createOverlayArtwork, wrapOverlayText, rasterizeAdComposition } = require('../dist/services/adComposition.js')
const { AdVideoRenderer } = require('../dist/services/AdVideoRenderer.js')
after(() => rm(root, { recursive: true, force: true }))
function command(program, args) {
  const result = spawnSync(program, args, { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr.toString())
  return result.stdout
}
function config(overrides = {}) {
  return AdProjectConfigSchema.parse({ texts: ['CAPTION'], timing: { mode: 'fixed', seconds: 1 }, variationCount: 1, colorPreset: 'none', ...overrides })
}
const layer = (overrides) => AdOverlaySchema.parse({ id: 'layer', type: 'shape', color: '#FF0000', x: 0, y: 0, width: 100, height: 100, ...overrides })
function sample(file, x, y, time = 0) {
  return [...command('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])]
}
function near(actual, expected, tolerance = 15) {
  assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) <= tolerance), `${actual} differs from ${expected}`)
}
test('schema defaults old projects, bounds layers, requires unique IDs, and allows carousel without global captions', () => {
  assert.deepEqual(config().overlays, [])
  assert.deepEqual(config().audioFinishing, { normalizeLoudness: false, targetLufs: -14 })
  assert.throws(() => config({ texts: [] }))
  assert.deepEqual(config({ kind: 'carousel', output: { width: 1080, height: 1080 }, texts: [] }).texts, [])
  for (const bad of [{x:-1}, {y:101}, {width:0}, {height:101}, {opacity:1.1}, {id:''}, {type:'text', fontSize:201}, {type:'text', text:'x'.repeat(281)}, {type:'image', assetId:-1}, {color:'red'}, {type:'video'}]) assert.equal(AdOverlaySchema.safeParse({id:'one', type:'shape', ...bad}).success, false)
  assert.throws(() => config({ overlays: Array.from({length:9}, (_, i) => layer({id:String(i)})) }))
  assert.throws(() => config({ overlays: [layer({}), layer({})] }))
})
test('text escapes XML, wraps deterministically and clips; hidden/transparent layers emit no markup', () => {
  const text = AdOverlaySchema.parse({id:'quoted', type:'text', text:'<script>& "hello"\nABCDE', fontSize:20})
  const svg = createOverlayArtwork([text, layer({id:'hidden',hidden:true}), layer({id:'clear',opacity:0})], {width:360,height:640})
  assert.ok(svg.includes('&lt;script&gt;&amp;'))
  assert.ok(!svg.includes('<script>'))
  assert.ok(svg.includes('clip-path="url(#layer0)"'))
  assert.ok(!svg.includes('layer1'))
  assert.deepEqual(wrapOverlayText('abc def ghi\n\n123456789', 70, 20), ['abc', 'def', 'ghi', '', '12345', '6789'])
})
test('rasterization respects array order, alpha, top-left geometry, and trusted image-only refs', async () => {
  const image = path.join(root, 'green.png')
  command('ffmpeg', ['-v','error','-y','-f','lavfi','-i','color=0x00ff00:s=32x32','-frames:v','1',image])
  const overlays = [layer({id:'base'}), layer({id:'alpha',color:'#0000FF',width:50,height:50,opacity:0.5}), layer({id:'hidden',hidden:true,color:'#FFFFFF'}), AdOverlaySchema.parse({id:'image',type:'image',assetId:3,x:60,y:60,width:20,height:20})]
  const png = await rasterizeAdComposition(config({output:{width:360,height:640},overlays}), [{id:3,kind:'image',storagePath:image}])
  const file = path.join(root,'composition.png'); writeFileSync(file,png)
  near(sample(file,10,10),[127,0,128],3)
  near(sample(file,220,400),[255,0,0],3) // transparent contain margin
  near(sample(file,240,440),[0,255,0],3)
  await assert.rejects(rasterizeAdComposition(config({overlays:[AdOverlaySchema.parse({id:'image',type:'image',assetId:3})]}), [{id:3,kind:'clip',storagePath:image}]), /indisponível/)
})
test('renderer burns ordered composition above caption into video variations and mixed JPG/MP4 carousel', async () => {
  const image = path.join(root,'source.png'), video = path.join(root,'source.mp4')
  command('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=black:s=64x64','-frames:v','1',image])
  command('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=black:s=64x64:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',video])
  const assets = [{id:1,kind:'image',storagePath:image,durationSeconds:0},{id:2,kind:'clip',storagePath:video,durationSeconds:1}]
  const overlays = [layer({id:'base',color:'#FF0000'}), layer({id:'top',color:'#0000FF',x:25,y:25,width:50,height:50})]
  const variations = await new AdVideoRenderer().render({id:501,projectId:99,configSnapshot:config({selectedClipIds:[1],output:{width:360,height:640,durationSeconds:3,fps:24},overlays})},assets,[],async()=>{})
  near(sample(variations[0].storagePath,180,330,1.2),[0,0,255])
  const slides = await new AdVideoRenderer().render({id:502,projectId:99,configSnapshot:config({kind:'carousel',texts:[],output:{width:1080,height:1080,fps:24},overlays,audioFinishing:{normalizeLoudness:true,targetLufs:-14},carousel:{slides:[{assetId:1,text:'CAPTION'},{assetId:2,text:'CAPTION',durationSeconds:3}]}})},assets,[],async()=>{})
  assert.deepEqual(slides.map(s=>s.mimeType),['image/jpeg','video/mp4'])
  for(const output of slides) { near(sample(output.storagePath,540,550),[0,0,255]); near(sample(output.storagePath,20,20),[255,0,0]) }
})
