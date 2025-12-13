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

// Find agent files linked to a session
export const findLinkedAgents = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const projectPath = path.join(getSessionsDir(), projectName)
    const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))
    const agentFiles = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))

    const linkedAgents: string[] = []

    for (const agentFile of agentFiles) {
      const filePath = path.join(projectPath, agentFile)
      const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
      const firstLine = content.split('\n')[0]

      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine) as { sessionId?: string }
          if (parsed.sessionId === sessionId) {
            linkedAgents.push(agentFile.replace('.jsonl', ''))
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return linkedAgents
  })

// Delete a session and its linked agent files
export const deleteSession = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const sessionsDir = getSessionsDir()
    const projectPath = path.join(sessionsDir, projectName)
    const filePath = path.join(projectPath, `${sessionId}.jsonl`)

    // Create backup directory
    const backupDir = path.join(projectPath, '.bak')
    yield* Effect.tryPromise(() => fs.mkdir(backupDir, { recursive: true }))

    // Find and delete linked agent files
    const linkedAgents = yield* findLinkedAgents(projectName, sessionId)
    const deletedAgents: string[] = []

    for (const agentId of linkedAgents) {
      const agentPath = path.join(projectPath, `${agentId}.jsonl`)
      const agentBackupPath = path.join(backupDir, `${agentId}.jsonl`)
      yield* Effect.tryPromise(() => fs.rename(agentPath, agentBackupPath))
      deletedAgents.push(agentId)
    }

    // Move session file to backup
    const backupPath = path.join(backupDir, `${sessionId}.jsonl`)
    yield* Effect.tryPromise(() => fs.rename(filePath, backupPath))

    return { success: true, backupPath, deletedAgents }
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
    const messages = lines.map((line) => JSON.parse(line) as Record<string, unknown>)

    // Find by uuid or messageId (for file-history-snapshot type)
    const targetIndex = messages.findIndex(
      (m) => m.uuid === messageUuid || m.messageId === messageUuid
    )
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

// Find orphan agent files (agents whose parent session no longer exists)
export const findOrphanAgents = (projectName: string) =>
  Effect.gen(function* () {
    const projectPath = path.join(getSessionsDir(), projectName)
    const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))

    const sessionIds = new Set(
      files
        .filter((f) => !f.startsWith('agent-') && f.endsWith('.jsonl'))
        .map((f) => f.replace('.jsonl', ''))
    )

    const agentFiles = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
    const orphanAgents: Array<{ agentId: string; sessionId: string }> = []

    for (const agentFile of agentFiles) {
      const filePath = path.join(projectPath, agentFile)
      const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
      const firstLine = content.split('\n')[0]

      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine) as { sessionId?: string }
          if (parsed.sessionId && !sessionIds.has(parsed.sessionId)) {
            orphanAgents.push({
              agentId: agentFile.replace('.jsonl', ''),
              sessionId: parsed.sessionId,
            })
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    return orphanAgents
  })

// Delete orphan agent files
export const deleteOrphanAgents = (projectName: string) =>
  Effect.gen(function* () {
    const projectPath = path.join(getSessionsDir(), projectName)
    const orphans = yield* findOrphanAgents(projectName)

    // Create backup directory
    const backupDir = path.join(projectPath, '.bak')
    yield* Effect.tryPromise(() => fs.mkdir(backupDir, { recursive: true }))

    const deletedAgents: string[] = []

    for (const orphan of orphans) {
      const agentPath = path.join(projectPath, `${orphan.agentId}.jsonl`)
      const agentBackupPath = path.join(backupDir, `${orphan.agentId}.jsonl`)
      yield* Effect.tryPromise(() => fs.rename(agentPath, agentBackupPath))
      deletedAgents.push(orphan.agentId)
    }

    return { success: true, deletedAgents, count: deletedAgents.length }
  })

// Clear sessions (empty and invalid)
export const clearSessions = (options: {
  projectName?: string
  clearEmpty?: boolean
  clearInvalid?: boolean
  clearOrphanAgents?: boolean
}) =>
  Effect.gen(function* () {
    const {
      projectName,
      clearEmpty = true,
      clearInvalid = true,
      clearOrphanAgents = true,
    } = options
    const cleanupPreview = yield* previewCleanup(projectName)

    let deletedCount = 0
    let deletedAgentCount = 0

    for (const result of cleanupPreview) {
      const toDelete = [
        ...(clearEmpty ? result.emptySessions : []),
        ...(clearInvalid ? result.invalidSessions : []),
      ]

      for (const session of toDelete) {
        const deleteResult = yield* deleteSession(result.project, session.id)
        deletedCount++
        deletedAgentCount += deleteResult.deletedAgents.length
      }

      // Clean up orphan agents after deleting sessions
      if (clearOrphanAgents) {
        const orphanResult = yield* deleteOrphanAgents(result.project)
        deletedAgentCount += orphanResult.count
      }
    }

    return { success: true, deletedCount, deletedAgentCount }
  })

// File change info extracted from session
export interface FileChange {
  path: string
  action: 'created' | 'modified' | 'deleted'
  timestamp?: string
  messageUuid?: string
}

// Session file changes summary
export interface SessionFilesSummary {
  sessionId: string
  projectName: string
  files: FileChange[]
  totalChanges: number
}

// Get changed files from a session
export const getSessionFiles = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const messages = yield* readSession(projectName, sessionId)
    const fileChanges: FileChange[] = []
    const seenFiles = new Set<string>()

    for (const msg of messages) {
      // Check for file-history-snapshot type
      if (msg.type === 'file-history-snapshot') {
        const snapshot = msg as unknown as {
          type: string
          messageId?: string
          snapshot?: {
            trackedFileBackups?: Record<string, unknown>
            timestamp?: string
          }
        }

        const backups = snapshot.snapshot?.trackedFileBackups
        if (backups && typeof backups === 'object') {
          for (const filePath of Object.keys(backups)) {
            if (!seenFiles.has(filePath)) {
              seenFiles.add(filePath)
              fileChanges.push({
                path: filePath,
                action: 'modified',
                timestamp: snapshot.snapshot?.timestamp,
                messageUuid: snapshot.messageId ?? msg.uuid,
              })
            }
          }
        }
      }

      // Also check tool_use for Write/Edit operations
      if (msg.type === 'assistant' && msg.message) {
        const assistantMsg = msg.message as {
          content?: Array<{ type: string; name?: string; input?: { file_path?: string } }>
        }
        const content = assistantMsg.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use' && (block.name === 'Write' || block.name === 'Edit')) {
              const filePath = block.input?.file_path
              if (filePath && !seenFiles.has(filePath)) {
                seenFiles.add(filePath)
                fileChanges.push({
                  path: filePath,
                  action: block.name === 'Write' ? 'created' : 'modified',
                  timestamp: msg.timestamp,
                  messageUuid: msg.uuid,
                })
              }
            }
          }
        }
      }
    }

    return {
      sessionId,
      projectName,
      files: fileChanges,
      totalChanges: fileChanges.length,
    } satisfies SessionFilesSummary
  })

// Split session at a specific message
export interface SplitSessionResult {
  success: boolean
  newSessionId?: string
  newSessionPath?: string
  movedMessageCount?: number
  error?: string
}

export const splitSession = (projectName: string, sessionId: string, splitAtMessageUuid: string) =>
  Effect.gen(function* () {
    const projectPath = path.join(getSessionsDir(), projectName)
    const filePath = path.join(projectPath, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)

    // Parse all messages preserving their full structure
    const allMessages = lines.map((line) => JSON.parse(line) as Record<string, unknown>)

    // Find the split point
    const splitIndex = allMessages.findIndex((m) => m.uuid === splitAtMessageUuid)
    if (splitIndex === -1) {
      return { success: false, error: 'Message not found' } satisfies SplitSessionResult
    }

    if (splitIndex === 0) {
      return { success: false, error: 'Cannot split at first message' } satisfies SplitSessionResult
    }

    // Generate new session ID
    const newSessionId = crypto.randomUUID()

    // Split messages
    const remainingMessages = allMessages.slice(0, splitIndex)
    const movedMessages = allMessages.slice(splitIndex)

    // Update moved messages with new sessionId and fix first message's parentUuid
    const updatedMovedMessages = movedMessages.map((msg, index) => {
      const updated: Record<string, unknown> = { ...msg, sessionId: newSessionId }
      if (index === 0) {
        // First message of new session should have no parent
        updated.parentUuid = null
      }
      return updated
    })

    // Write remaining messages to original file
    const remainingContent = remainingMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    yield* Effect.tryPromise(() => fs.writeFile(filePath, remainingContent, 'utf-8'))

    // Write moved messages to new session file
    const newFilePath = path.join(projectPath, `${newSessionId}.jsonl`)
    const newContent = updatedMovedMessages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    yield* Effect.tryPromise(() => fs.writeFile(newFilePath, newContent, 'utf-8'))

    // Update linked agent files that reference the old sessionId
    const agentFiles = yield* Effect.tryPromise(() => fs.readdir(projectPath))
    const agentJsonlFiles = agentFiles.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))

    for (const agentFile of agentJsonlFiles) {
      const agentPath = path.join(projectPath, agentFile)
      const agentContent = yield* Effect.tryPromise(() => fs.readFile(agentPath, 'utf-8'))
      const agentLines = agentContent.trim().split('\n').filter(Boolean)

      if (agentLines.length === 0) continue

      const firstAgentMsg = JSON.parse(agentLines[0]) as { sessionId?: string }

      // If this agent belongs to the original session, check if it should be moved
      if (firstAgentMsg.sessionId === sessionId) {
        // Check if any message in moved messages is related to this agent
        const agentId = agentFile.replace('agent-', '').replace('.jsonl', '')
        const isRelatedToMoved = movedMessages.some(
          (msg) => (msg as { agentId?: string }).agentId === agentId
        )

        if (isRelatedToMoved) {
          // Update all messages in this agent file to reference new sessionId
          const updatedAgentMessages = agentLines.map((line) => {
            const msg = JSON.parse(line) as Record<string, unknown>
            return JSON.stringify({ ...msg, sessionId: newSessionId })
          })
          const updatedAgentContent = updatedAgentMessages.join('\n') + '\n'
          yield* Effect.tryPromise(() => fs.writeFile(agentPath, updatedAgentContent, 'utf-8'))
        }
      }
    }

    return {
      success: true,
      newSessionId,
      newSessionPath: newFilePath,
      movedMessageCount: movedMessages.length,
    } satisfies SplitSessionResult
  })

// Get file changes diff summary for a session
export interface FileDiffSummary {
  sessionId: string
  projectName: string
  title: string
  changes: Array<{
    path: string
    action: 'created' | 'modified' | 'deleted'
    hasBackup: boolean
    backupPreview?: string
  }>
  totalFiles: number
  snapshotCount: number
}

export const getSessionDiffSummary = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const messages = yield* readSession(projectName, sessionId)

    // Extract title
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

    const changes: FileDiffSummary['changes'] = []
    const seenFiles = new Set<string>()
    let snapshotCount = 0

    for (const msg of messages) {
      if (msg.type === 'file-history-snapshot') {
        snapshotCount++
        const snapshot = msg as {
          type: string
          snapshot?: {
            trackedFileBackups?: Record<string, { content?: string }>
          }
        }

        const backups = snapshot.snapshot?.trackedFileBackups
        if (backups && typeof backups === 'object') {
          for (const [filePath, backup] of Object.entries(backups)) {
            if (!seenFiles.has(filePath)) {
              seenFiles.add(filePath)
              const backupData = backup as { content?: string } | undefined
              const content = backupData?.content ?? ''
              changes.push({
                path: filePath,
                action: 'modified',
                hasBackup: content.length > 0,
                backupPreview: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
              })
            }
          }
        }
      }
    }

    return {
      sessionId,
      projectName,
      title,
      changes,
      totalFiles: changes.length,
      snapshotCount,
    } satisfies FileDiffSummary
  })
