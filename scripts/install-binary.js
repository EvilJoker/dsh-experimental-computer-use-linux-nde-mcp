#!/usr/bin/env node
/**
 * postinstall hook for @ashtonsun/dsh-experimental-computer-use-linux-nde-mcp.
 *
 * Downloads the Nde-adapted musl-static computer-use binary from the
 * computer-use-linux-zte-nde GitHub release identified by the
 * `binaryTag` field in package.json, verifies its SHA-256, runs a
 * --help smoke test, and chmods it executable.
 *
 * Failure modes (all warn-and-continue, never block install):
 *   - missing `binaryTag`           → skip (lets forks override via env)
 *   - network error                 → skip (lets user install manually)
 *   - sha256 mismatch               → hard fail (deletes the bad binary)
 *   - binary already present        → skip (idempotent)
 *
 * No package size cost: this script itself is ~3 KB and lives outside the
 * `lib/` build output; the binary is downloaded into `bin/` which is
 * git-ignored and excluded from the npm tarball (consumer-side install).
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import https from 'node:https'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(__dirname, '..')
const require = createRequire(import.meta.url)

// ----- Config -----
const REPO = 'EvilJoker/computer-use-linux-zte-nde'
const BIN_NAME = 'computer-use-linux-static-claude-nde-x86_64-unknown-linux-musl'
const BIN_DIR = join(pkgRoot, 'bin')
const BIN_PATH = join(BIN_DIR, BIN_NAME)

// ----- Load binaryTag -----
const pkgJson = require(join(pkgRoot, 'package.json'))
const tag = pkgJson.binaryTag
if (!tag) {
  console.log('[install-binary] no "binaryTag" in package.json — skipping')
  process.exit(0)
}

if (existsSync(BIN_PATH)) {
  const size = statSync(BIN_PATH).size
  console.log(`[install-binary] binary already present at ${BIN_PATH} (${size} bytes) — skipping`)
  process.exit(0)
}

// ----- Download with redirects -----
function fetchWithRedirects(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && redirectsLeft > 0) {
        const next = res.headers.location
        if (!next) return reject(new Error(`HTTP ${res.statusCode} with no Location header for ${url}`))
        res.resume()
        resolve(fetchWithRedirects(next, redirectsLeft - 1))
        return
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(60_000, () => req.destroy(new Error('request timed out after 60s')))
  })
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function cleanUp() {
  try {
    if (existsSync(BIN_PATH)) rmSync(BIN_PATH)
  } catch (_) {
    /* swallow */
  }
}

async function main() {
  const baseUrl = `https://github.com/${REPO}/releases/download/${tag}/${BIN_NAME}`
  const shaUrl = `${baseUrl}.sha256`

  console.log(`[install-binary] target: ${tag}`)
  console.log(`[install-binary] url:    ${baseUrl}`)

  let binBuf, shaExpected
  try {
    ;[binBuf, shaExpected] = await Promise.all([fetchWithRedirects(baseUrl), fetchWithRedirects(shaUrl)])
  } catch (e) {
    console.warn(`[install-binary] WARN: download failed: ${e.message}`)
    console.warn(`[install-binary] WARN: you can install the binary manually:`)
    console.warn(`[install-binary] WARN:   curl -L -o ${BIN_PATH} '${baseUrl}'`)
    console.warn(`[install-binary] WARN:   chmod +x ${BIN_PATH}`)
    process.exit(0)
  }

  const shaActual = sha256Hex(binBuf)
  // sha256 file format: "<hex>  <filename>" or just "<hex>"
  const expected = shaExpected.toString().trim().split(/\s+/)[0]
  console.log(`[install-binary] expected sha256: ${expected}`)
  console.log(`[install-binary] actual   sha256: ${shaActual}`)
  if (expected.toLowerCase() !== shaActual.toLowerCase()) {
    console.error('[install-binary] sha256 mismatch — refusing to write binary')
    cleanUp()
    process.exit(1)
  }

  // Ensure bin/ exists and write the binary
  await import('node:fs').then((fs) => fs.mkdirSync(BIN_DIR, { recursive: true }))
  const { writeFileSync } = await import('node:fs')
  writeFileSync(BIN_PATH, binBuf, { mode: 0o755 })
  console.log(`[install-binary] wrote ${binBuf.length} bytes to ${BIN_PATH}`)

  // Smoke test
  const r = spawnSync(BIN_PATH, ['--help'], { encoding: 'utf8', timeout: 30_000 })
  if (r.status !== 0) {
    console.error(`[install-binary] --help smoke test failed (exit ${r.status})`)
    console.error(r.stderr?.split('\n').slice(0, 5).join('\n'))
    cleanUp()
    process.exit(1)
  }
  // Re-assert executable bit in case fs write didn't honor mode
  chmodSync(BIN_PATH, 0o755)
  console.log(`[install-binary] smoke OK: ${(r.stdout || '').trim().split('\n').slice(-1)[0] || '(binary ready)'}`)
}

main().catch((e) => {
  console.error(`[install-binary] uncaught error: ${e.message}`)
  process.exit(1)
})