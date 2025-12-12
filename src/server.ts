import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.join(__dirname, '..', 'web')

interface WebServer {
  process: ChildProcess
  port: number
}

export async function startWebServer(
  port: number = 5050,
  openBrowser: boolean = true
): Promise<WebServer> {
  // Run SvelteKit preview
  const child = spawn('pnpm', ['preview', '--port', String(port)], {
    cwd: webDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) },
  })

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000)

    child.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      if (output.includes('localhost') || output.includes('Local:')) {
        clearTimeout(timeout)
        resolve()
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout)
        reject(new Error(`Server exited with code ${code}`))
      }
    })
  })

  // Open browser if requested
  if (openBrowser) {
    const url = `http://localhost:${port}`
    const openCmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
    spawn(openCmd, [url], { stdio: 'ignore', detached: true }).unref()
  }

  return { process: child, port }
}

export async function stopWebServer(server: WebServer): Promise<void> {
  server.process.kill('SIGTERM')
}
