// Copies the barcode reader's WebAssembly file (zxing-wasm, used by the
// scanner's barcode-detector fallback on iPhone / Samsung Internet) into
// public/, so the ERP serves it itself instead of loading it from a CDN.
// Runs at postinstall — the file always matches the installed version.
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const wasm = require.resolve('zxing-wasm/reader/zxing_reader.wasm')
mkdirSync('public/vendor', { recursive: true })
copyFileSync(wasm, join('public', 'vendor', 'zxing_reader.wasm'))
console.log('zxing_reader.wasm → public/vendor/')
