import { Effect, pipe, Array as A, Option as O } from 'effect'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as shared from '../../../../src/lib/shared/index.js'

// Re-export shared utilities
export const {
  getSessionsDir,
  findLinkedAgents,
  findOrphanAgents,
  deleteOrphanAgents,
  findLinkedTodos,
  sessionHasTodos,
  deleteLinkedTodos,
  findOrphanTodos,
  deleteOrphanTodos,
} = shared

// Types
interface ContentItem {
  type: string
  text?: string
  name?: string
  input?: unknown
}

interface MessagePayload {
  role?: string
  content?: ContentItem[] | string
  model?: string
}

export interface Message {
  uuid: string
  parentUuid?: string | null
  type: string
  message?: MessagePayload
  timestamp?: string
}

export interface SessionMeta {
  id: string
  projectName: string
  title?: string
  messageCount: number
  createdAt?: string
  updatedAt?: string
}

export interface Project {
  name: string
  display_name: string
  path: string
  sessionCount: number
}

// Extract text content from message
const extractTextContent = (message: MessagePayload | undefined): string => {
  if (!message) return ''

  const content = message.content
  if (!content) return ''

  // If content is string, return directly
  if (typeof content === 'string') return content

  // If content is array, extract text items
  if (Array.isArray(content)) {
    return content
      .filter((item): item is ContentItem => typeof item === 'object' && item?.type === 'text')
      .map((item) => item.text ?? '')
      .join('')
  }

  return ''
}

// Extract title from text content (remove IDE tags, use first line)
const extractTitle = (text: string): string => {
  if (!text) return 'Untitled'

  // Remove IDE tags (<ide_opened_file>, <ide_selection>, etc.)
  let cleaned = text.replace(/<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g, '').trim()

  if (!cleaned) return 'Untitled'

  // Use only content before \n\n or \n as title
  if (cleaned.includes('\n\n')) {
    cleaned = cleaned.split('\n\n')[0]
  } else if (cleaned.includes('\n')) {
    cleaned = cleaned.split('\n')[0]
  }

  // Limit to 100 characters
  if (cleaned.length > 100) {
    return cleaned.slice(0, 100) + '...'
  }

  return cleaned || 'Untitled'
}

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
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((entry) =>
        Effect.gen(function* () {
          const projectPath = path.join(sessionsDir, entry.name)
          const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))
          // Exclude agent- files (subagent logs)
          const sessionFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))

          // Convert folder name to display path (e.g., -Users-david-works -> /Users/david/works)
          // Handle dot-prefixed folders: --claude -> /.claude, -works--vscode -> /works/.vscode
          const displayName = entry.name
            .replace(/^-/, '/')
            .replace(/--/g, '/.') // double dash means dot-prefixed folder
            .replace(/-/g, '/')

          return {
            name: entry.name,
            display_name: displayName,
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
    // Exclude agent- files (subagent logs)
    const sessionFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))

    const sessions = yield* Effect.all(
      sessionFiles.map((file) =>
        Effect.gen(function* () {
          const filePath = path.join(projectPath, file)
          const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
          const lines = content.trim().split('\n').filter(Boolean)
          const messages = lines.map((line) => JSON.parse(line) as Message)

          const sessionId = file.replace('.jsonl', '')

          // Filter only user/assistant messages for counting
          const userAssistantMessages = messages.filter(
            (m) => m.type === 'user' || m.type === 'assistant'
          )
          const firstMessage = userAssistantMessages[0]
          const lastMessage = userAssistantMessages[userAssistantMessages.length - 1]

          // Extract title from first user message
          const title = pipe(
            messages,
            A.findFirst((m) => m.type === 'user'),
            O.map((m) => {
              const text = extractTextContent(m.message)
              return extractTitle(text)
            }),
            O.getOrElse(() => `Session ${sessionId.slice(0, 8)}`)
          )

          return {
            id: sessionId,
            projectName,
            title,
            messageCount: userAssistantMessages.length,
            createdAt: firstMessage?.timestamp,
            updatedAt: lastMessage?.timestamp,
          } satisfies SessionMeta
        })
      ),
      { concurrency: 10 }
    )

    // Sort by newest first
    return sessions.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return dateB - dateA
    })
  })

// Read session messages
export const readSession = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.map((line) => JSON.parse(line) as Message)
  })

// Delete a session and its linked agent/todo files
export const deleteSession = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const sessionsDir = getSessionsDir()
    const projectPath = path.join(sessionsDir, projectName)
    const filePath = path.join(projectPath, `${sessionId}.jsonl`)

    // Find linked agents first (before any deletion)
    const linkedAgents = yield* findLinkedAgents(projectName, sessionId)

    // Check file size - if empty (0 bytes), just delete without backup
    const stat = yield* Effect.tryPromise(() => fs.stat(filePath))
    if (stat.size === 0) {
      yield* Effect.tryPromise(() => fs.unlink(filePath))
      // Still delete linked agents and todos for empty sessions
      const agentBackupDir = path.join(projectPath, '.bak')
      yield* Effect.tryPromise(() => fs.mkdir(agentBackupDir, { recursive: true }))
      for (const agentId of linkedAgents) {
        const agentPath = path.join(projectPath, `${agentId}.jsonl`)
        const agentBackupPath = path.join(agentBackupDir, `${agentId}.jsonl`)
        yield* Effect.tryPromise(() => fs.rename(agentPath, agentBackupPath).catch(() => {}))
      }
      yield* deleteLinkedTodos(sessionId, linkedAgents)
      return { success: true, deletedAgents: linkedAgents.length }
    }

    // Create backup directory
    const backupDir = path.join(sessionsDir, '.bak')
    yield* Effect.tryPromise(() => fs.mkdir(backupDir, { recursive: true }))

    // Delete linked agent files (move to .bak in project folder)
    const agentBackupDir = path.join(projectPath, '.bak')
    yield* Effect.tryPromise(() => fs.mkdir(agentBackupDir, { recursive: true }))
    for (const agentId of linkedAgents) {
      const agentPath = path.join(projectPath, `${agentId}.jsonl`)
      const agentBackupPath = path.join(agentBackupDir, `${agentId}.jsonl`)
      yield* Effect.tryPromise(() => fs.rename(agentPath, agentBackupPath).catch(() => {}))
    }

    // Delete linked todo files
    const todosResult = yield* deleteLinkedTodos(sessionId, linkedAgents)

    // Move session to backup (format: project_name_session_id.jsonl)
    const backupPath = path.join(backupDir, `${projectName}_${sessionId}.jsonl`)
    yield* Effect.tryPromise(() => fs.rename(filePath, backupPath))

    return {
      success: true,
      backupPath,
      deletedAgents: linkedAgents.length,
      deletedTodos: todosResult.deletedCount,
    }
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

    // Find first user message
    const firstUserIdx = messages.findIndex((m) => m.type === 'user')
    if (firstUserIdx === -1) {
      return { success: false, error: 'No user message found' }
    }

    const firstMsg = messages[firstUserIdx]
    if (firstMsg?.message?.content && Array.isArray(firstMsg.message.content)) {
      // Find first non-IDE text content
      const textIdx = firstMsg.message.content.findIndex(
        (item): item is ContentItem =>
          typeof item === 'object' &&
          item?.type === 'text' &&
          !item.text?.trim().startsWith('<ide_')
      )

      if (textIdx >= 0) {
        const item = firstMsg.message.content[textIdx] as ContentItem
        const oldText = item.text ?? ''
        // Remove existing title pattern (first line ending with \n\n)
        const cleanedText = oldText.replace(/^[^\n]+\n\n/, '')
        item.text = `${newTitle}\n\n${cleanedText}`
      }
    }

    const newContent = messages.map((m) => JSON.stringify(m)).join('\n') + '\n'
    yield* Effect.tryPromise(() => fs.writeFile(filePath, newContent, 'utf-8'))

    return { success: true }
  })

// Update custom-title message
export const updateCustomTitle = (
  projectName: string,
  sessionId: string,
  messageUuid: string,
  newTitle: string
) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)
    const messages = lines.map((line) => JSON.parse(line) as Message)

    const targetIndex = messages.findIndex((m) => m.uuid === messageUuid)
    if (targetIndex === -1) {
      return { success: false, error: 'Message not found' }
    }

    const msg = messages[targetIndex]
    if (msg.type !== 'custom-title') {
      return { success: false, error: 'Message is not a custom-title type' }
    }

    // Update customTitle field
    ;(msg as Message & { customTitle?: string }).customTitle = newTitle

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

// Check if message contains "Invalid API key"
const isInvalidApiKeyMessage = (msg: Message): boolean => {
  const text = extractTextContent(msg.message)
  return text.includes('Invalid API key')
}

// Remove invalid API key messages from a session, returns remaining message count
const cleanInvalidMessages = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const filePath = path.join(getSessionsDir(), projectName, `${sessionId}.jsonl`)
    const content = yield* Effect.tryPromise(() => fs.readFile(filePath, 'utf-8'))
    const lines = content.trim().split('\n').filter(Boolean)

    if (lines.length === 0) return { removedCount: 0, remainingCount: 0 }

    const messages = lines.map((line) => JSON.parse(line) as Message)
    const invalidIndices: number[] = []

    // Find all invalid API key messages
    messages.forEach((msg, idx) => {
      if (isInvalidApiKeyMessage(msg)) {
        invalidIndices.push(idx)
      }
    })

    if (invalidIndices.length === 0) {
      const userAssistantCount = messages.filter(
        (m) => m.type === 'user' || m.type === 'assistant'
      ).length
      return { removedCount: 0, remainingCount: userAssistantCount }
    }

    // Remove invalid messages and fix parentUuid chain
    const filtered: Message[] = []
    let lastValidUuid: string | null = null

    for (let i = 0; i < messages.length; i++) {
      if (invalidIndices.includes(i)) {
        continue // Skip invalid message
      }

      const msg = messages[i]
      // Update parentUuid to point to last valid message
      if (msg.parentUuid && invalidIndices.some((idx) => messages[idx]?.uuid === msg.parentUuid)) {
        msg.parentUuid = lastValidUuid
      }
      filtered.push(msg)
      lastValidUuid = msg.uuid
    }

    const newContent =
      filtered.length > 0 ? filtered.map((m) => JSON.stringify(m)).join('\n') + '\n' : ''

    yield* Effect.tryPromise(() => fs.writeFile(filePath, newContent, 'utf-8'))

    const remainingUserAssistant = filtered.filter(
      (m) => m.type === 'user' || m.type === 'assistant'
    ).length
    return { removedCount: invalidIndices.length, remainingCount: remainingUserAssistant }
  })

// File change tracking types
export interface FileChange {
  path: string
  action: 'created' | 'modified' | 'deleted'
  timestamp?: string
  messageUuid?: string
}

export interface SessionFilesSummary {
  sessionId: string
  projectName: string
  files: FileChange[]
  totalChanges: number
}

// Get files changed in a session (from file-history-snapshot and tool_use)
export const getSessionFiles = (projectName: string, sessionId: string) =>
  Effect.gen(function* () {
    const messages = yield* readSession(projectName, sessionId)
    const fileChanges: FileChange[] = []
    const seenFiles = new Set<string>()

    for (const msg of messages) {
      // Check file-history-snapshot type
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

      // Check tool_use for Write/Edit operations
      if (msg.type === 'assistant' && msg.message?.content) {
        const content = msg.message.content
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item && typeof item === 'object' && 'type' in item && item.type === 'tool_use') {
              const toolUse = item as { name?: string; input?: { file_path?: string } }
              if (
                (toolUse.name === 'Write' || toolUse.name === 'Edit') &&
                toolUse.input?.file_path
              ) {
                const filePath = toolUse.input.file_path
                if (!seenFiles.has(filePath)) {
                  seenFiles.add(filePath)
                  fileChanges.push({
                    path: filePath,
                    action: toolUse.name === 'Write' ? 'created' : 'modified',
                    timestamp: msg.timestamp,
                    messageUuid: msg.uuid,
                  })
                }
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

// Split session result type
export interface SplitSessionResult {
  success: boolean
  newSessionId?: string
  newSessionPath?: string
  movedMessageCount?: number
  error?: string
}

// Split session at a specific message
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

// Clear sessions: 1) Remove invalid API key messages 2) Delete empty sessions
export const clearSessions = (options: {
  projectName?: string
  clearEmpty?: boolean
  clearInvalid?: boolean
}) =>
  Effect.gen(function* () {
    const { projectName, clearEmpty = true } = options
    const projects = yield* listProjects
    const targetProjects = projectName ? projects.filter((p) => p.name === projectName) : projects

    let deletedSessionCount = 0
    let removedMessageCount = 0
    const sessionsToDelete: { project: string; sessionId: string }[] = []

    // Step 1: Clean invalid API key messages from all sessions
    for (const project of targetProjects) {
      const projectPath = path.join(getSessionsDir(), project.name)
      const files = yield* Effect.tryPromise(() => fs.readdir(projectPath))
      const sessionFiles = files.filter((f) => f.endsWith('.jsonl') && !f.startsWith('agent-'))

      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '')
        const result = yield* cleanInvalidMessages(project.name, sessionId)
        removedMessageCount += result.removedCount

        // Mark for deletion if now empty
        if (result.remainingCount === 0) {
          sessionsToDelete.push({ project: project.name, sessionId })
        }
      }
    }

    // Step 2: Also find originally empty sessions (if clearEmpty is true)
    if (clearEmpty) {
      for (const project of targetProjects) {
        const sessions = yield* listSessions(project.name)
        for (const session of sessions) {
          if (session.messageCount === 0) {
            const alreadyMarked = sessionsToDelete.some(
              (s) => s.project === project.name && s.sessionId === session.id
            )
            if (!alreadyMarked) {
              sessionsToDelete.push({ project: project.name, sessionId: session.id })
            }
          }
        }
      }
    }

    // Step 3: Delete all empty sessions
    for (const { project, sessionId } of sessionsToDelete) {
      yield* deleteSession(project, sessionId)
      deletedSessionCount++
    }

    return {
      success: true,
      deletedCount: deletedSessionCount,
      removedMessageCount,
    }
  })
