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
 * Additional standalone landing pages, each served at its own route. Each dir
 * contains an index.html (+ optional assets) and is copied to dist/<route>/ on
 * build and served at /<route> in dev.
 */
const EXTRA_LANDINGS: { route: string; dir: string }[] = [
  { route: 'masculino', dir: 'landing/masculino' },
  { route: 'bio', dir: 'landing/bio' },
]

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
}

function serveFile(res: import('http').ServerResponse, file: string): void {
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  createReadStream(file).pipe(res)
}

/**
 * Serve the public landing page (landing/index.html) at `/` during dev, plus
 * any EXTRA_LANDINGS at their routes, so the root shows the marketing LP while
 * the support app lives under /painel.
 */
function landingDevServer(): Plugin {
  return {
    name: 'landing-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]

        // Root landing.
        if (url === '/' || url === '/index.html') {
          if (existsSync(LANDING)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(readFileSync(LANDING, 'utf-8'))
            return
          }
        }

        // Extra landings: /<route> (and /<route>/...) + their assets.
        for (const { route, dir } of EXTRA_LANDINGS) {
          const base = `/${route}`
          if (url === base || url === `${base}/` || url === `${base}/index.html`) {
            const html = resolve(__dirname, dir, 'index.html')
            if (existsSync(html)) {
              res.setHeader('Content-Type', 'text/html; charset=utf-8')
              res.end(readFileSync(html, 'utf-8'))
              return
            }
          }
          if (url.startsWith(`${base}/`)) {
            const rel = url.slice(base.length + 1)
            const file = resolve(__dirname, dir, rel)
            if (existsSync(file) && statSync(file).isFile()) {
              serveFile(res, file)
              return
            }
          }
        }

        // Root landing assets at /assets/*.
        if (url.startsWith('/assets/')) {
          const rel = url.replace('/assets/', '')
          const file = join(LANDING_ASSETS, rel)
          if (existsSync(file) && statSync(file).isFile()) {
            serveFile(res, file)
            return
          }
        }
        next()
      })
    },
  }
}

/**
 * After Vite builds the app into dist/painel (outDir below), place the public
 * landing page at dist/index.html with its assets at dist/assets, copy each
 * extra landing to dist/<route>/, and ship serve.json.
 */
function landingBuild(): Plugin {
  return {
    name: 'landing-build',
    apply: 'build',
    closeBundle() {
      const distRoot = resolve(__dirname, 'dist')
      mkdirSync(distRoot, { recursive: true })
      // Root landing page.
      if (existsSync(LANDING)) copyFileSync(LANDING, resolve(distRoot, 'index.html'))
      if (existsSync(LANDING_ASSETS)) {
        cpSync(LANDING_ASSETS, resolve(distRoot, 'assets'), { recursive: true })
      }
      // Extra landings → dist/<route>/ (entire dir, incl. assets).
      for (const { route, dir } of EXTRA_LANDINGS) {
        const src = resolve(__dirname, dir)
        if (existsSync(src)) cpSync(src, resolve(distRoot, route), { recursive: true })
      }
      // SPA rewrites for /painel + landing routes.
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
  build: {
    // Build the whole app self-contained under dist/painel so its assets live
    // at dist/painel/assets and /painel/assets/* resolves on the static host.
    outDir: 'dist/painel',
    emptyOutDir: true,
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
