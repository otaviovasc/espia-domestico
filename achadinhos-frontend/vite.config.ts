import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, copyFileSync, existsSync, mkdirSync, cpSync, createReadStream, statSync } from 'node:fs'
import { resolve, dirname, join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LANDING = resolve(__dirname, 'landing/index.html')
const LANDING_ASSETS = resolve(__dirname, 'landing/assets')

/** The internal support app is served under this base path (not at root). */
const APP_BASE = '/painel/'

/**
 * Serve the public landing page (landing/index.html) at `/` during dev, so the
 * root shows the marketing LP while the support app lives under /painel.
 */
function landingDevServer(): Plugin {
  return {
    name: 'landing-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        if (url === '/' || url === '/index.html') {
          if (existsSync(LANDING)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(readFileSync(LANDING, 'utf-8'))
            return
          }
        }
        // Serve landing/assets/* at /assets/* and ./assets/* in dev.
        if (url.startsWith('/assets/')) {
          const rel = url.replace('/assets/', '')
          const file = join(LANDING_ASSETS, rel)
          if (existsSync(file) && statSync(file).isFile()) {
            const ext = extname(file).toLowerCase()
            const mime: Record<string, string> = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
              '.ico': 'image/x-icon',
            }
            res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
            res.setHeader('Cache-Control', 'public, max-age=3600')
            createReadStream(file).pipe(res)
            return
          }
        }
        next()
      })
    },
  }
}

/** On build: app HTML → dist/painel/index.html, landing page → dist/index.html. */
function landingBuild(): Plugin {
  return {
    name: 'landing-build',
    apply: 'build',
    closeBundle() {
      const distRoot = resolve(__dirname, 'dist')
      const appHtml = resolve(distRoot, 'index.html') // Vite built the SPA here
      const painelDir = resolve(distRoot, 'painel')
      // Move the built SPA entry under /painel/ so it is reachable at /painel.
      if (existsSync(appHtml)) {
        mkdirSync(painelDir, { recursive: true })
        copyFileSync(appHtml, resolve(painelDir, 'index.html'))
      }
      // Landing page becomes the site root.
      if (existsSync(LANDING)) copyFileSync(LANDING, appHtml)
      // Ship landing assets (logo + review prints + depo photos) to dist/assets.
      if (existsSync(LANDING_ASSETS)) {
        cpSync(LANDING_ASSETS, resolve(distRoot, 'assets'), { recursive: true })
      }
      // Ship serve.json (SPA rewrites for /painel) alongside the build.
      const serveJson = resolve(__dirname, 'serve.json')
      if (existsSync(serveJson)) copyFileSync(serveJson, resolve(distRoot, 'serve.json'))
    },
  }
}

export default defineConfig({
  base: APP_BASE,
  plugins: [react(), tailwindcss(), landingDevServer(), landingBuild()],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5273,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
})
