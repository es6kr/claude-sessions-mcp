import { Effect, pipe, Array as A, Option as O } from 'effect'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Message, SessionMeta, Project } from './schema.js'

// Get Claude sessions directory
export const getSessionsDir = (): string => path.join(os.homedir(), '.claude', 'projects')

// List all project directories
export const listProjects = Effect.gen(function* () {
  const sessionsDir = getSessionsDir()

  const exists = yield* Effect.tryPromise(() =>
    fs
      .access(sessionsDir)
      .then(() => true)
      .catch(() => false)
  )

  if (!exists) {
    return [] as Project[]
  }

  const entries = yield* Effect.tryPromise(() => fs.readdir(sessionsDir, { withFileTypes: true }))

  const projects = yield* Effect.all(
    entries
      .filter((e) => e.isDirectory())
      .map((entry) =>
        Effect.gen(function* () {
          const projectPath = path.join(sessionsDir, entry.name)
          const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))
          const sessionFiles = files.filter((f) => f.endsWith('.jsonl'))

          return {
            name: entry.name,
            path: projectPath,
            sessionCount: sessionFiles.length,
          } satisfies Project
        })
      ),
    { concurrency: 10 }
  )

  return projects
})

// List sessions in a project
export const listSessions = (projectName: string) =>
  Effect.gen(function* () {
    const projectPath = path.join(getSessionsDir(), projectName)
    const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))
    const sessionFiles = files.filter((f) => f.endsWith('.jsonl'))

    const sessions = yield* Effect.all(
      sessionFiles.map((file) =>
        Effect.gen(function* () {
          const filePath = path.join(projectPath, file)
          const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
          const lines = content.trim().split('\n').filter(Boolean)
          const messages = lines.map((line) => JSON.parse(line) as Message)

          const sessionId = file.replace('.jsonl', '')
          const firstMessage = messages[0]
          const lastMessage = messages[messages.length - 1]

          // Extract title from first user message
          const title = pipe(
            messages,
            A.findFirst((m) => m.type === 'human'),
            O.map((m) => {
              const msg = m.message as { content?: string } | undefined
              const content = msg?.content ?? ''
              return content.slice(0, 50) + (content.length > 50 ? '...' : '')
            }),
            O.getOrElse(() => 'Untitled')
          )

          return {
            id: sessionId,
            projectName,
            title,
            messageCount: messages.length,
            createdAt: firstMessage?.timestamp,
            updatedAt: lastMessage?.timestamp,
          } satisfies SessionMeta
        })
      ),
      { concurrency: 10 }
    )

    return sessions
  })

// Read session messages
export const readSession = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.map((line) => JSON.parse(line) as Message)
  })

// Delete a session
export const deleteSession = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const sessionsDir = getSessionsDir()
    const filePath = path.join(sessionsDir, projectName, `${sessionId}.jsonl`)

    // Create backup directory
    const backupDir = path.join(sessionsDir, projectName, '.bak')
    yield* Effect.tryPromise(() => fs.mkdir(backupDir, { recursive: true }))

    // Move to backup
    const backupPath = path.join(backupDir, `${sessionId}.jsonl`)
    yield* Effect.tryPromise(() => fs.rename(filePath, backupPath))

    return { success: true, backupPath }
  })

// Rename session by adding title prefix
export const renameSession = (projectName: string, sessionId: string, newTitle: string) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)

    if (lines.length === 0) {
      return { success: false, error: 'Empty session' }
    }

    const messages = lines.map((line) => JSON.parse(line) as Message)
    const firstMsg = messages[0]

    // Add title prefix to first message
    if (firstMsg && typeof firstMsg.message === 'object' && firstMsg.message !== null) {
      const msg = firstMsg.message as { content?: string }
      if (msg.content) {
        // Remove existing title prefix if any
        const cleanContent = msg.content.replace(/^\[.*?\]\s*/, '')
        msg.content = `[${newTitle}] ${cleanContent}`
      }
    }

    const newContent = messages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    yield* Effect.tryPromise(() => fs.writeFile(filePath, newContent, 'utf-8'))

    return { success: true }
  })

// Delete a message from session
export const deleteMessage = (projectName: string, sessionId: string, messageUuid: string) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)
    const messages = lines.map((line) => JSON.parse(line) as Message)

    const targetIndex = messages.findIndex((m) => m.uuid === messageUuid)
    if (targetIndex === -1) {
      return { success: false, error: 'Message not found' }
    }

    // Get the parent UUID of deleted message
    const deletedMsg = messages[targetIndex]
    const parentUuid = deletedMsg?.parentUuid

    // Update child message to point to deleted message's parent
    const nextMsg = messages[targetIndex + 1]
    if (nextMsg) {
      nextMsg.parentUuid = parentUuid
    }

    // Remove the message
    messages.splice(targetIndex, 1)

    const newContent = messages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    yield* Effect.tryPromise(() => fs.writeFile(filePath, newContent, 'utf-8'))

    return { success: true }
  })

// Preview cleanup - find empty and invalid sessions
export const previewCleanup = (projectName?: string) =>
  Effect.gen(function* () {
    const projects = yield* listProjects
    const targetProjects = projectName ? projects.filter((p) => p.name === projectName) : projects

    const results = yield* Effect.all(
      targetProjects.map((project) =>
        Effect.gen(function* () {
          const sessions = yield* listSessions(project.name)
          const emptySessions = sessions.filter((s) => s.messageCount === 0)
          const invalidSessions = sessions.filter(
            (s) => s.title?.includes('Invalid API key') || s.title?.includes('API key')
          )

          return {
            project: project.name,
            emptySessions,
            invalidSessions,
          }
        })
      ),
      { concurrency: 5 }
    )

    return results
  })

// Clear sessions (empty and invalid)
export const clearSessions = (options: {
  projectName?: string
  clearEmpty?: boolean
  clearInvalid?: boolean
}) =>
  Effect.gen(function* () {
    const { projectName, clearEmpty = true, clearInvalid = true } = options
    const cleanupPreview = yield* previewCleanup(projectName)

    let deletedCount = 0

    for (const result of cleanupPreview) {
      const toDelete = [
        ...(clearEmpty ? result.emptySessions : []),
        ...(clearInvalid ? result.invalidSessions : []),
      ]

      for (const session of toDelete) {
        yield* deleteSession(result.project, session.id)
        deletedCount++
      }
    }

    return { success: true, deletedCount }
  })
