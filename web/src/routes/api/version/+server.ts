import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgPath = path.resolve(__dirname, '../../../../../../package.json')

let version = '0.1.0'
try {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  version = pkg.version
} catch {
  // fallback
}

export const GET: RequestHandler = async () => {
  return json({ version })
}
