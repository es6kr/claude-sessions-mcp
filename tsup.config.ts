import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/mcp/index.ts', 'src/server.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  shims: true,
})
