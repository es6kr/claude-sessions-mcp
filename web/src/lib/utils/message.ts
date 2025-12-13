/**
 * Message content utilities
 */

import type { Message } from '$lib/api'

/**
 * Extract displayable content from message
 */
export const getMessageContent = (msg: Message): string => {
  const m = msg.message as { content?: unknown } | undefined
  if (!m?.content) return ''

  // If content is string, return directly
  if (typeof m.content === 'string') return m.content

  // If content is array, extract text items
  if (Array.isArray(m.content)) {
    return m.content
      .filter(
        (item): item is { type: string; text?: string } =>
          typeof item === 'object' && item?.type === 'text'
      )
      .map((item) => item.text ?? '')
      .join('')
  }

  return JSON.stringify(m.content)
}

/**
 * Parse command message content
 */
export const parseCommandMessage = (content?: string): { name: string; message: string } => {
  const name = content?.match(/<command-name>([^<]+)<\/command-name>/)?.[1] ?? ''
  const message = content?.match(/<command-message>([^<]+)<\/command-message>/)?.[1] ?? ''
  return { name, message }
}
