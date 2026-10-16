import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderLandingPage } from './template.ts'
import { femininoConfig, masculinoConfig } from './configs.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

function buildLandings() {
  console.log('Generating high-converting landing pages...')

  // 1. Root Landing Page (Feminino / Geral)
  const femininoHtml = renderLandingPage(femininoConfig)
  const rootTarget = resolve(__dirname, 'index.html')
  writeFileSync(rootTarget, femininoHtml, 'utf-8')
  console.log(`✓ Root landing page written to ${rootTarget} (${Buffer.byteLength(femininoHtml)} bytes)`)

  // 2. Male Landing Page (/masculino)
  const masculinoHtml = renderLandingPage(masculinoConfig)
  const maleDir = resolve(__dirname, 'masculino')
  mkdirSync(maleDir, { recursive: true })
  const maleTarget = resolve(maleDir, 'index.html')
  writeFileSync(maleTarget, masculinoHtml, 'utf-8')
  console.log(`✓ Masculino landing page written to ${maleTarget} (${Buffer.byteLength(masculinoHtml)} bytes)`)

  console.log('All landing pages built successfully!')
}

buildLandings()
