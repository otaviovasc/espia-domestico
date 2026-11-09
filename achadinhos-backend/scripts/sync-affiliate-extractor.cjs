const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const source = path.resolve(process.argv[2] || '../../afiliados-extension')
const destination = path.resolve(__dirname, '../vendor/affiliate-hub')
const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const dirty = !!execFileSync('git', ['-C', source, 'status', '--porcelain', '--', 'src/extractor.js', 'src/page-fiber.js'], { encoding: 'utf8' }).trim()
fs.mkdirSync(destination, { recursive: true })
const files = {}
for (const name of ['extractor.js', 'page-fiber.js']) {
  const content = fs.readFileSync(path.join(source, 'src', name))
  fs.writeFileSync(path.join(destination, name), content)
  files[name] = crypto.createHash('sha256').update(content).digest('hex')
}
fs.writeFileSync(path.join(destination, 'provenance.json'), JSON.stringify({ repository: 'https://github.com/Marlos001/afiliados-extension', revision, includesUncommittedChanges: dirty, sha256: files }, null, 2) + '\n')
console.log('Synchronized extractor and share bridge; integrity hashes recorded in vendor/affiliate-hub/provenance.json')
