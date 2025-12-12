const BASE_URL = '/api'

export interface Project {
  name: string
  display_name: string
  path: string
  sessionCount: number
}

export interface SessionMeta {
  id: string
  projectName: string
  title?: string
  messageCount: number
  createdAt?: string
  updatedAt?: string
}

export interface Message {
  uuid: string
  parentUuid?: string | null
  type: string
  message?: unknown
  timestamp?: string
}

export interface CleanupPreview {
  project: string
  emptySessions: SessionMeta[]
  invalidSessions: SessionMeta[]
}

// Fetch helpers
const get = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const del = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

const patch = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// API functions
export const listProjects = () => get<Project[]>('/projects')

export const listSessions = (project: string) =>
  get<SessionMeta[]>(`/sessions?project=${encodeURIComponent(project)}`)

export const getSession = (project: string, id: string) =>
  get<Message[]>(`/session?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`)

export const deleteSession = (project: string, id: string) =>
  del<{ success: boolean }>(
    `/session?project=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`
  )

export const renameSession = (project: string, id: string, title: string) =>
  post<{ success: boolean }>('/session/rename', { project, id, title })

export const deleteMessage = (project: string, session: string, uuid: string) =>
  del<{ success: boolean }>(
    `/message?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&uuid=${encodeURIComponent(uuid)}`
  )

export const updateCustomTitle = (
  project: string,
  session: string,
  uuid: string,
  customTitle: string
) =>
  patch<{ success: boolean }>(
    `/message?project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}&uuid=${encodeURIComponent(uuid)}`,
    { customTitle }
  )

export const previewCleanup = (project?: string) =>
  get<CleanupPreview[]>(`/cleanup${project ? `?project=${encodeURIComponent(project)}` : ''}`)

export const clearSessions = (options: {
  project?: string
  clearEmpty?: boolean
  clearInvalid?: boolean
}) => post<{ success: boolean; deletedCount: number }>('/cleanup', options)

export const getVersion = () => get<{ version: string }>('/version')
