#!/usr/bin/env node
// Convert obsolete base64 Minfolio comments to the readable plain-text form.
//   <!--folio-comment:BASE64-->  ->  <!-- folio-comment: <text> -->
// Usage: node tools/migrate-comments.mjs <file> [--write]
import { readFileSync, writeFileSync } from 'node:fs'

const [file, ...flags] = process.argv.slice(2)
if (!file) { console.error('usage: migrate-comments.mjs <file> [--write]'); process.exit(1) }
const write = flags.includes('--write')

const OLD = /<!--folio-comment:([A-Za-z0-9_-]+)-->/g
const escape = (t) => t.replace(/\r?\n/g, ' ').replace(/-->/g, '--&gt;')

function decode(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')
  const json = Buffer.from(padded, 'base64').toString('utf8')
  return JSON.parse(json)
}

const src = readFileSync(file, 'utf8')
let count = 0, failed = 0
const out = src.replace(OLD, (whole, b64) => {
  try {
    const { text } = decode(b64)
    if (typeof text !== 'string') throw new Error('no text field')
    count++
    return `<!-- folio-comment: ${escape(text)} -->`
  } catch (e) {
    failed++
    console.error('  ! could not decode one token:', e.message)
    return whole
  }
})

console.log(`${file}: ${count} comment(s) converted${failed ? `, ${failed} failed` : ''}`)
if (count) {
  // show what changed
  for (const m of src.matchAll(OLD)) {
    try { console.log('   •', JSON.stringify(decode(m[1]).text)) } catch {}
  }
}
if (write && count) { writeFileSync(file, out, 'utf8'); console.log('  -> written') }
else if (count) console.log('  (dry run — pass --write to apply)')
