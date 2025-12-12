import { json, error } from '@sveltejs/kit'
import { exec } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'
import { join } from 'path'
import type { RequestHandler } from './$types'

const execAsync = promisify(exec)

export const POST: RequestHandler = async ({ request }) => {
  const { sessionId, backupFileName } = await request.json()
  if (!sessionId || !backupFileName) {
    throw error(400, 'sessionId and backupFileName required')
  }

  // Construct the file path: ~/.claude/file-history/{sessionId}/{backupFileName}
  const filePath = join(homedir(), '.claude', 'file-history', sessionId, backupFileName)

  try {
    // Open the file in VS Code using the code command
    await execAsync(`code "${filePath}"`)
    return json({ success: true })
  } catch (e) {
    throw error(500, `Failed to open file: ${e}`)
  }
}
