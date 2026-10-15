#!/usr/bin/env node
// Disposable, local-only UI fixtures. No production database, external network,
// paid AI calls, or WhatsApp messages. See ui-platform-qa.md for mock boundaries.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const backend = path.resolve(__dirname, '../achadinhos-backend')
const fromBackend = name => require(path.join(backend, name))
fromBackend('node_modules/dotenv').config({ path: path.join(backend, '.env'), quiet: true })
fromBackend('node_modules/reflect-metadata')
const { Client } = fromBackend('node_modules/pg')
const database = `achadinhos_ui_qa_${Date.now()}_${process.pid}`
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'achadinhos-ui-qa-'))
const port = Number(process.env.UI_QA_PORT || 3118)
const email = 'platform-qa@example.invalid'
const password = 'Platform-QA-local-2026'
const serve = process.argv.includes('--serve')
const groups = [
  { id: '120363000000001@g.us', name: 'Casa prática · ofertas', participantsCount: 248 },
  { id: '120363000000002@g.us', name: 'Cozinha & organização', participantsCount: 137 },
  { id: '120363000000003@g.us', name: 'Achadinhos do fim de semana', participantsCount: 89 },
  { id: '120363000000004@g.us', name: 'Novidades · só administradores', participantsCount: 54, announce: true },
]
let server, sequelize, adminUrl, stopQueue, cleaned = false
const clock = new Date()
const ago = minutes => new Date(clock.getTime() - minutes * 60_000)
const later = minutes => new Date(clock.getTime() + minutes * 60_000)

async function cleanup() {
  if (cleaned) return
  cleaned = true
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  if (stopQueue) await stopQueue()
  if (sequelize) await sequelize.close()
  if (adminUrl) {
    const client = new Client({ connectionString: adminUrl })
    await client.connect()
    try { await client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`) }
    finally { await client.end() }
  }
  fs.rmSync(directory, { recursive: true, force: true })
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', ...options })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}
function localUrl(input) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname), 'QA blocks external network')
}
function blockExternalHttp() {
  const originalFetch = global.fetch
  global.fetch = (input, ...args) => { localUrl(input); return originalFetch(input, ...args) }
  for (const protocol of ['node:http', 'node:https']) {
    const mod = require(protocol)
    const request = mod.request
    mod.request = function (input, ...args) {
      if (typeof input === 'string' || input instanceof URL) localUrl(input)
      else {
        const hostname = input.hostname || input.host || 'localhost'
        assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname), 'QA blocks external network')
      }
      return request.call(this, input, ...args)
    }
    mod.get = function (...args) { const req = mod.request(...args); req.end(); return req }
  }
}
function mockUazapi() {
  const { UazapiClient } = fromBackend('dist/channels/uazapi/UazapiClient.js')
  const { AppError } = fromBackend('dist/middleware/Error/AppError.js')
  let connected = !process.argv.includes('--disconnected'), pairAt = null, webhooks = []
  const instance = () => ({ id: 'ui-qa-only', owner: '5511999990000', status: connected ? 'connected' : 'disconnected' })
  // Replace every public provider operation, before the app resolves its DI container.
  Object.assign(UazapiClient.prototype, {
    async createInstance() { return { instance: instance(), token: 'ui-qa-fake-token' } },
    async deleteInstance() { connected = false },
    async connect(_creds, phone) {
      pairAt = Date.now() + 12_000
      connected = false
      return phone ? { paircode: 'QA12-3456', connected: false } : {
        qrcode: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="white"/><path d="M24 24h64v64H24zm128 0h64v64h-64zM24 152h64v64H24zM112 112h32v32h-32zm40 40h64v32h-64zm-40 32h32v32h-32z" fill="#193c34"/><text x="120" y="135" text-anchor="middle" font-size="12">QA · NÃO ESCANEAR</text></svg>').toString('base64'),
        connected: false,
      }
    },
    async getStatus() {
      if (pairAt && Date.now() >= pairAt) { connected = true; pairAt = null }
      return { instance: instance(), status: { connected, loggedIn: connected } }
    },
    async disconnect() { connected = false; pairAt = null },
    async getWebhooks() { return webhooks },
    async setWebhook(_creds, params) { webhooks = [{ ...params, id: 'qa-webhook' }] },
    async listGroups(_creds, { offset = 0, limit = 500 } = {}) { return groups.slice(offset, offset + limit) },
    async groupInfo(_creds, id) { return groups.find(g => g.id === id) || {} },
    async sendText(_creds, params) { return fakeSend(params) },
    async sendMedia(_creds, params) { return fakeSend(params) },
  })
  function fakeSend(params) {
    if (!connected) throw new AppError('QA: conexão simulada desconectada.', 400, 'QA_DISCONNECTED')
    if (!groups.some(g => g.id === params.number)) throw new AppError('QA: grupo simulado não encontrado.', 400, 'QA_GROUP_NOT_FOUND')
    if (String(params.text).includes('[falhar]')) throw new AppError('QA: falha simulada de envio. Remova [falhar] e tente novamente.', 502, 'QA_SIMULATED_FAILURE')
    return { messageid: `qa-not-sent-${randomUUID()}`, status: 'qa-simulated' }
  }
}

async function main() {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname), 'Requires local PostgreSQL')
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid UI_QA_PORT')
  const admin = new URL(url); admin.pathname = '/postgres'; adminUrl = admin.href
  const client = new Client({ connectionString: adminUrl })
  await client.connect()
  try { await client.query(`CREATE DATABASE "${database}"`) } finally { await client.end() }
  url.pathname = `/${database}`
  Object.assign(process.env, {
    DATABASE_URL: url.href, UI_QA_DATABASE_URL: url.href, NODE_ENV: 'test',
    API_PREFIX: '/api/v1', API_BASE_URL: `http://127.0.0.1:${port}`, CORS_ORIGIN: '*',
    COOKIE_SECURE: 'false', RUN_SCHEDULER: 'false', LOG_LEVEL: 'error',
    JWT_SECRET: 'ui-platform-qa-only-secret-at-least-32-characters',
    UAZAPI_ADMIN_TOKEN: 'ui-qa-fake-admin-token', UAZAPI_BASE_URL: 'http://127.0.0.1:1',
    OPENROUTER_KEY: '', AI_ENABLED: 'false', AD_STORAGE_DRIVER: 'local', AD_RENDER_CONCURRENCY: '1',
    AD_MEDIA_DIR: path.join(directory, 'media'),
  })
  const migrations = path.join(directory, 'sequelize.cjs')
  fs.writeFileSync(migrations, "module.exports={test:{use_env_variable:'UI_QA_DATABASE_URL',dialect:'postgres',logging:false}}")
  command(process.execPath, [path.join(backend, 'node_modules/sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test', '--config', migrations], { cwd: backend, env: process.env })
  blockExternalHttp()
  mockUazapi()
  sequelize = fromBackend('dist/database/index.js').sequelize
  const { User } = fromBackend('dist/database/models/User.js')
  const { Connection } = fromBackend('dist/database/models/Connection.js')
  const { connectionScopeForCredentials } = fromBackend('dist/services/ConnectionService.js')
  const { Campaign, CAMPAIGN_STATUS_ENUM } = fromBackend('dist/database/models/Campaign.js')
  const { CampaignLog } = fromBackend('dist/database/models/CampaignLog.js')
  const { GroupMessage } = fromBackend('dist/database/models/GroupMessage.js')
  const { createApp } = fromBackend('dist/app.js')
  const { generateToken } = fromBackend('dist/middleware/auth.js')
  const queue = fromBackend('dist/services/AdRenderQueue.js')
  stopQueue = queue.stopAdRenderQueue
  await fromBackend('dist/services/AdMediaService.js').ensureAdMediaDirectories()
  const user = await User.create({ name: 'Marina · conta de demonstração', email, passwordHash: await fromBackend('node_modules/bcrypt').hash(password, 10), role: 'ADMIN' })
  const credentials = { baseUrl: 'http://127.0.0.1:1', instanceId: 'ui-qa-only', instanceToken: 'ui-qa-fake-token' }
  const connection = await Connection.create({ userId: user.id, credentials, status: process.argv.includes('--disconnected') ? 'DISCONNECTED' : 'CONNECTED', phoneNumber: '5511999990000', lastConnectedAt: ago(30) })
  const scope = connectionScopeForCredentials(credentials)
  const express = fromBackend('node_modules/express')
  const app = express()
  const publicDirectory = path.join(directory, 'public')
  fs.mkdirSync(publicDirectory)
  app.use('/api/v1/__qa/assets', express.static(publicDirectory))
  app.get('/api/v1/__qa/info', (_req, res) => res.json({ fixture: 'ui-platform-qa', scheduler: false, outboundHttp: 'loopback-only', uazapi: 'process-local mock, no real sends', ai: 'disabled', database, email }))
  app.use(createApp())
  server = app.listen(port, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = `http://127.0.0.1:${port}/api/v1`, token = generateToken(user)
  async function json(suffix, method = 'GET', data, expected = 200) {
    const response = await fetch(base + suffix, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) })
    const body = await response.json()
    assert.equal(response.status, expected, `${method} ${suffix}: ${JSON.stringify(body)}`)
    return body.data
  }
  async function upload(id, kind, file, mime) {
    const form = new FormData(); form.set('kind', kind)
    form.append('files', new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file))
    const response = await fetch(`${base}/ad-projects/${id}/assets`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form })
    const body = await response.json(); assert.equal(response.status, 201, JSON.stringify(body)); return body.data[0]
  }
  const palettes = [['#e9f2ed', '#35634e'], ['#f5e7d8', '#b77a40'], ['#e5ebf1', '#426486'], ['#eee8f2', '#846598']]
  const { Resvg } = fromBackend('node_modules/@resvg/resvg-js')
  for (let i = 0; i < 4; i++) {
    const [background, ink] = palettes[i]
    const shapes = [
      `<ellipse cx="270" cy="410" rx="154" ry="32" fill="${ink}" opacity=".12"/><rect x="133" y="290" width="274" height="110" rx="22" fill="${ink}"/><rect x="355" y="310" width="122" height="25" rx="12" fill="#28372e"/><ellipse cx="270" cy="290" rx="137" ry="30" fill="#c6d5cc"/><ellipse cx="270" cy="290" rx="116" ry="22" fill="#243c30"/>`,
      `<ellipse cx="270" cy="440" rx="130" ry="26" fill="${ink}" opacity=".12"/><path d="M270 230v180M210 410h120" stroke="${ink}" stroke-width="17" stroke-linecap="round"/><path d="M195 210h150l55 110H140z" fill="${ink}"/><path d="M205 210h130" stroke="#ffe2b8" stroke-width="10"/>`,
      `<ellipse cx="270" cy="430" rx="150" ry="25" fill="${ink}" opacity=".12"/><rect x="130" y="265" width="280" height="150" rx="26" fill="${ink}"/><rect x="121" y="250" width="298" height="35" rx="13" fill="#aac0d2"/><rect x="225" y="305" width="90" height="32" rx="11" fill="#e5ebf1"/><rect x="160" y="355" width="220" height="5" rx="2" fill="#e5ebf1" opacity=".3"/>`,
      `<ellipse cx="270" cy="430" rx="130" ry="22" fill="${ink}" opacity=".12"/><rect x="176" y="225" width="188" height="195" rx="50" fill="${ink}"/><rect x="197" y="255" width="146" height="105" rx="28" fill="#292734"/><rect x="242" y="300" width="56" height="15" rx="7" fill="#c4b4d2"/><circle cx="270" cy="390" r="12" fill="#e4d9ee"/>`,
    ]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="675"><rect width="540" height="675" fill="${background}"/><circle cx="270" cy="320" r="195" fill="white" opacity=".44"/>${shapes[i]}<text x="270" y="550" font-family="sans-serif" font-size="18" text-anchor="middle" fill="${ink}">ESPIA · MÍDIA DE DEMONSTRAÇÃO</text></svg>`
    fs.writeFileSync(path.join(publicDirectory, `produto-${i + 1}.png`), new Resvg(svg).render().asPng())
  }
  const products = [
    ['Frigideira antiaderente com tampa · 24 cm', 159.9, 99.9, 'A', 'mercadolivre', 'COZINHA15'],
    ['Luminária de mesa articulada em madeira', 189.9, 139.9, 'A', 'amazon', 'CASA10'],
    ['Kit 6 caixas organizadoras empilháveis', 119.9, 89.9, 'B', 'shopee', ''],
    ['Air fryer digital compacta · 4 litros', 429.9, 349.9, 'B', 'mercadolivre', 'ESPIA20'],
    ['Jogo de toalhas de banho · algodão', 129.9, 119.9, 'C', 'amazon', ''],
    ['Fone sem fio esportivo · preto', 149.9, 129.9, 'D', 'shopee', ''],
  ].map(([title, originalPrice, discountedPrice, category, source, coupon], i) => ({ title, originalPrice, discountedPrice, category, source, coupon, currency: 'BRL', description: 'Produto fictício para verificar os fluxos da plataforma. Nenhum link gera compra ou comissão.', affiliateUrl: `https://example.invalid/qa/produto-${i + 1}`, imageUrl: `${base}/__qa/assets/produto-${i % 4 + 1}.png`, productId: `QA-${i + 1}`, commissioned: i < 4, commissionRate: 12 - i, commissionPercent: `${12 - i}%`, relevanceScore: [95, 90, 78, 70, 45, 12][i], discountPercent: Math.round((1 - discountedPrice / originalPrice) * 100), classificationProfileId: 'default', classificationProfileName: 'Doméstico' }))
  await json('/saved-products', 'POST', { offers: products })
  const saved = (await json('/saved-products')).items.sort((a, b) => a.offer.productId.localeCompare(b.offer.productId))
  assert.ok(Array.isArray(saved) && saved.length === products.length, 'Catalog fixture count')
  const catalogOffers = saved.map(product => ({ ...product.offer, savedProductId: product.id }))
  const kitchen = await json('/product-groups', 'POST', { name: 'Cozinha que funciona' }, 201)
  const home = await json('/product-groups', 'POST', { name: 'Casa & organização' }, 201)
  await json('/saved-products/groups', 'PUT', { productIds: [saved[0].id, saved[3].id], groupIds: [kitchen.id], mode: 'add' })
  await json('/saved-products/groups', 'PUT', { productIds: [saved[1].id, saved[2].id], groupIds: [home.id], mode: 'add' })
  const { DEFAULT_CLASSIFICATION_PROFILE } = fromBackend('dist/dtos/classificationProfile.js')
  const { id: _id, builtIn: _builtIn, ...profile } = DEFAULT_CLASSIFICATION_PROFILE
  await json('/classification-profiles', 'POST', { ...profile, name: 'Cozinha e mesa', nicheDescription: 'Utensílios de cozinha, organização da despensa e mesa posta.' }, 201)
  const { CreateCampaignSchema } = fromBackend('dist/dtos/campaign.js')
  const safety = { minDelaySeconds: 2, maxDelaySeconds: 4, shuffleGroups: false, shuffleOffers: false, maxPerHour: 120, warmupBatchSize: 0, warmupPauseFactor: 3 }
  const campaigns = []
  for (const [name, status] of [
    ['Cozinha de quinta · revisão', 'DRAFT'], ['Casa prática · amanhã, 10h', 'SCHEDULED'],
    ['Organização · envio em andamento', 'RUNNING'], ['Seleção da semana · pausada', 'PAUSED'],
    ['Especial de cozinha · concluída', 'COMPLETED'], ['Iluminação · precisa de atenção', 'FAILED'],
    ['Teste cancelado', 'CANCELLED'],
  ]) {
    const input = CreateCampaignSchema.parse({ name, offers: catalogOffers.slice(0, 3), groups: groups.slice(0, 2).map(({ id, name }) => ({ id, name })), safety })
    const campaign = await Campaign.create({ ...input, userId: user.id, status: CAMPAIGN_STATUS_ENUM[status], scheduledAt: status === 'SCHEDULED' ? later(24 * 60) : null, startedAt: ['RUNNING', 'COMPLETED', 'FAILED', 'PAUSED'].includes(status) ? ago(60) : null, heartbeatAt: status === 'RUNNING' ? new Date() : null, completedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? ago(15) : null, totalSent: status === 'COMPLETED' ? 6 : ['RUNNING', 'PAUSED', 'FAILED'].includes(status) ? 2 : 0, totalFailed: status === 'FAILED' ? 1 : 0 })
    campaigns.push({ id: campaign.id, name, status })
    if (['COMPLETED', 'RUNNING', 'FAILED', 'PAUSED'].includes(status)) {
      await CampaignLog.bulkCreate(Array.from({ length: status === 'COMPLETED' ? 6 : status === 'FAILED' ? 3 : 2 }, (_, i) => ({ campaignId: campaign.id, connectionScope: scope, groupId: groups[i % 2].id, groupName: groups[i % 2].name, offerTitle: catalogOffers[i % 3].title, offerSource: catalogOffers[i % 3].source, offerUrl: catalogOffers[i % 3].affiliateUrl, success: !(status === 'FAILED' && i === 2), error: status === 'FAILED' && i === 2 ? 'QA: falha simulada do provedor. Reenvio disponível.' : null, messageId: `qa-seeded-${campaign.id}-${i}`, sentAt: ago(50 - i) })))
    }
  }
  // The seeded RUNNING record is a static UI scenario; no sender loop is started.
  const heartbeat = setInterval(() => { void Campaign.update({ heartbeatAt: new Date() }, { where: { id: campaigns.find(c => c.status === 'RUNNING').id, status: 'RUNNING' } }).catch(() => {}) }, 30_000)
  heartbeat.unref()
  const originalStopQueue = stopQueue
  stopQueue = async () => { clearInterval(heartbeat); await originalStopQueue() }
  for (const [groupIndex, texts] of [
    [0, ['Bom dia! A seleção de cozinha já está por aqui.', 'Essa frigideira pode ir ao forno?', 'O fabricante recomenda uso no fogão. Confira os detalhes antes de comprar.', 'Obrigada! Vou conferir.']],
    [1, ['Hoje a seleção é para organizar a casa.', 'O kit de caixas tem mais de um tamanho?', 'Sim, são seis peças empilháveis. Veja as medidas no anúncio.']],
  ]) {
    for (const [i, text] of texts.entries()) await GroupMessage.create({ connectionScope: scope, groupId: groups[groupIndex].id, groupName: groups[groupIndex].name, direction: i % 2 ? 'in' : 'out', messageId: `qa-thread-${groupIndex}-${i}`, sender: i % 2 ? '5511988880000@s.whatsapp.net' : null, senderName: i % 2 ? 'Ana · participante fictícia' : null, fromMe: i % 2 === 0, text, timestamp: ago(12 - i * 2), ...(i === 0 ? { mediaType: 'image', mediaUrl: products[groupIndex].imageUrl } : {}) })
  }
  const clip = path.join(directory, 'produto-em-uso.mp4')
  command('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', path.join(publicDirectory, 'produto-1.png'), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-t', '3', '-vf', 'scale=360:640', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', clip])
  const music = path.join(directory, 'trilha-demonstracao.mp3')
  command('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-c:a', 'libmp3lame', music])
  const { AdProjectConfigSchema } = fromBackend('dist/dtos/adProject.js')
  const config = AdProjectConfigSchema.parse({ kind: 'carousel', texts: ['Mais praticidade na sua cozinha', 'Achadinhos para a casa acontecer'], timing: { mode: 'fixed', seconds: 3 }, output: { width: 1080, height: 1350, durationSeconds: 6, fps: 24 }, colorPreset: 'none', productIds: saved.slice(0, 3).map(p => p.id) })
  const carousel = await json('/ad-projects', 'POST', { name: 'Cozinha prática · carrossel', config }, 201)
  const still = await upload(carousel.id, 'image', path.join(publicDirectory, 'produto-1.png'), 'image/png')
  const second = await upload(carousel.id, 'image', path.join(publicDirectory, 'produto-2.png'), 'image/png')
  const motion = await upload(carousel.id, 'clip', clip, 'video/mp4')
  const audio = await upload(carousel.id, 'music', music, 'audio/mpeg')
  config.carousel = { caption: 'Uma seleção de achadinhos para uma cozinha mais prática. Demonstração local.', slides: [{ assetId: still.id, text: 'Pequenas escolhas, grandes facilidades', durationSeconds: 5 }, { assetId: motion.id, text: 'Veja o produto em movimento', durationSeconds: 3 }, { assetId: second.id, text: 'Sua casa, do seu jeito', durationSeconds: 5 }] }
  await json(`/ad-projects/${carousel.id}`, 'PATCH', { config })
  await json(`/ad-projects/${carousel.id}/assets/${still.id}/library`, 'POST', { name: 'Frigideira · imagem principal', tags: ['cozinha', 'produto'], productIds: [saved[0].id] })
  await json(`/ad-projects/${carousel.id}/assets/${motion.id}/library`, 'POST', { name: 'Frigideira em uso · vídeo', tags: ['vídeo', 'cozinha'], productIds: [saved[0].id] })
  const videoConfig = { ...config, kind: 'video', variationCount: 1, carousel: { slides: [], caption: '' }, selectedClipIds: [still.id, motion.id], musicAssetId: audio.id, output: { width: 360, height: 640, durationSeconds: 6, fps: 24 } }
  // Duplication copies the real private assets and remaps references through the API.
  const video = await json(`/ad-projects/${carousel.id}/duplicate`, 'POST', {}, 201)
  const detail = await json(`/ad-projects/${video.id}`)
  const remapped = { ...videoConfig, selectedClipIds: detail.assets.filter(a => ['image', 'clip'].includes(a.kind)).map(a => a.id), musicAssetId: detail.assets.find(a => a.kind === 'music').id }
  await json(`/ad-projects/${video.id}`, 'PATCH', { name: 'Casa em movimento · vídeo vertical', config: remapped })
  await queue.startAdRenderQueue()
  const render = await json(`/ad-projects/${video.id}/render-jobs`, 'POST', {}, 202)
  const renderDeadline = Date.now() + 90_000
  let completedRender
  while (Date.now() < renderDeadline) {
    completedRender = await json(`/ad-projects/${video.id}/render-jobs/${render.id}`)
    assert.notEqual(completedRender.status, 'failed', completedRender.error)
    if (completedRender.status === 'completed') break
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  assert.equal(completedRender.status, 'completed', 'Local fixture render timed out')
  await json('/ad-projects/studio/brand', 'POST', { key: 'qa-espia', payload: { name: 'Espia · assinatura principal', textStyle: config.textStyle, backgroundColor: '#193C34', signature: '@espia.domestico · demonstração' } })
  const templateConfig = { ...config, productIds: [], carousel: { ...config.carousel, slides: [] } }
  await json('/ad-projects/studio/template', 'POST', { key: 'qa-carousel', payload: { name: 'Seleção de cozinha · 3 telas', config: templateConfig, slideLayouts: config.carousel.slides.map(({ assetId, ...slide }) => slide) } })
  await json('/ad-projects/studio/publication', 'POST', { key: 'qa-planned', payload: { name: 'Seleção de quinta · Instagram', projectId: carousel.id, scheduledAt: later(180).toISOString(), status: 'scheduled', caption: config.carousel.caption, productIds: saved.slice(0, 3).map(p => p.id) } })
  await json('/ad-projects/studio/publication', 'POST', { key: 'qa-published', payload: { name: 'Casa prática · resultados de exemplo', projectId: video.id, jobId: render.id, status: 'published', caption: 'Demonstração com métricas manuais fictícias.', postUrl: 'https://example.invalid/qa/publicacao', publishedAt: ago(1440).toISOString(), productIds: [saved[0].id], metrics: { impressions: 2480, clicks: 163, saves: 42, likes: 128, comments: 9, sales: 4, revenue: 399.6, attribution: 'Dados fictícios inseridos manualmente para QA local.', observedAt: clock.toISOString(), source: 'manual' } } })
  // Focused negative checks exercise actual validators and ownership-independent routes.
  await json('/campaigns', 'POST', { name: '', offers: [], groups: [], safety }, 400)
  await json(`/groups/${groups[0].id}/messages`, 'POST', { text: 'Reprodução [falhar]' }, process.argv.includes('--disconnected') ? 400 : 502)
  await json(`/saved-products/${saved[0].id}`, 'PATCH', { offer: { discountedPrice: -1 } }, 400)
  // Persisted review-only smart fixtures exercise the real API without paid analysis.
  const smartAudiences = await json('/smart-campaigns/audiences')
  const domestic = await json('/smart-campaigns/audiences/domestica', 'PUT', { enabled: true, destinationGroupIds: [groups[0].id] })
  await json('/smart-campaigns/audiences/masculino', 'PUT', { enabled: true, destinationGroupIds: [groups[1].id] })
  const { SmartPlan, SMART_PLAN_STATUS } = fromBackend('dist/database/models/SmartPlan.js')
  const { SmartPlanItemSchema } = fromBackend('dist/dtos/smartCampaign.js')
  const smartDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(clock)
  const smartItems = catalogOffers.slice(0, 3).map((offer, index) => SmartPlanItemSchema.parse({
    id: `${index}:domestica`, audienceSlug: 'domestica', date: smartDate,
    state: ['SELECTED', 'RESERVE', 'REJECTED'][index],
    product: { ...offer, commissionedUrlStatus: 'generated_from_page_state', extensionEvidence: { extractedAt: clock.toISOString(), commission: { percent: 12, priceBrl: offer.discountedPrice, estimatedBrl: offer.discountedPrice * .12, basis: 'visible_current_price_times_displayed_percent', guaranteed: false } } },
    score: 92 - index * 20, fitScore: 95 - index * 10, estimatedCommission: offer.discountedPrice * .12,
    freshnessHours: 1, reason: 'Dados fictícios para revisão local. Não representam análise de IA.',
    standout: index === 0, customMessage: index === 0 ? 'Mais praticidade na cozinha, com detalhes para você conferir.' : null,
    observedAt: clock.toISOString(),
  }))
  const smartPlans = []
  for (const status of [SMART_PLAN_STATUS.REVIEW, SMART_PLAN_STATUS.REVIEW, SMART_PLAN_STATUS.PAUSED]) {
    const plan = await SmartPlan.create({ userId: user.id, status, startDate: smartDate, days: 1, timezone: 'America/Sao_Paulo', audienceSlugs: ['domestica'], input: { offers: smartItems.map(item => item.product), observedAt: smartItems.map(item => item.observedAt), source: 'fixture', totalSeen: 3, errors: [], duplicateCount: 0 }, items: smartItems, settings: { audiences: { domestica: domestic.policy } }, progress: { phase: 'COMPLETE', completed: 3, total: 3 }, warnings: ['Plano de demonstração local, sem análise paga.'] })
    smartPlans.push({ id: plan.uuid, status })
  }
  assert.equal(smartAudiences.length, 5)
  const manifest = { api: base, database, directory, email, password, connectionId: connection.id, campaigns, smartPlans, projects: { carousel: carousel.id, video: video.id, completedJob: render.id }, groups, productIds: saved.map(p => p.id), mocks: ['UAZAPI status/lifecycle/groups/webhooks', 'UAZAPI sends recorded locally only; [falhar] yields 502', 'AI disabled; external HTTP blocked', 'Smart plan items are directly seeded synthetic review fixtures'], scheduler: false }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('PASS: disposable migrations, catalog/groups/profiles, seven campaign states/logs, chat threads, real mixed media uploads, library/studio records, actual invalid-action responses.')
  console.log(JSON.stringify(manifest, null, 2))
  console.log(`Browser QA ready: proxy /api to http://127.0.0.1:${port}\nLogin: ${email} / ${password}\nCtrl+C removes this QA database and all temporary media. All provider behavior is simulated.`)
  if (!serve) await cleanup()
}
process.once('SIGINT', () => { void cleanup().then(() => process.exit(0)) })
process.once('SIGTERM', () => { void cleanup().then(() => process.exit(0)) })
main().catch(async error => { console.error(error); await cleanup(); process.exitCode = 1 })
