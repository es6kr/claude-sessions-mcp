<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import * as api from '$lib/api'
  import type { Project, SessionMeta, Message } from '$lib/api'

  // Session cache per project
  let projects = $state<Project[]>([])
  let projectSessions = $state<Map<string, SessionMeta[]>>(new Map())
  let expandedProjects = $state<Set<string>>(new Set())
  let selectedSession = $state<SessionMeta | null>(null)
  let messages = $state<Message[]>([])
  let loading = $state(false)
  let loadingProject = $state<string | null>(null)
  let error = $state<string | null>(null)

  // Parse URL hash: #project=xxx&session=yyy
  const parseHash = (): { project?: string; session?: string } => {
    if (!browser) return {}
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    return {
      project: params.get('project') ?? undefined,
      session: params.get('session') ?? undefined,
    }
  }

  // Update URL hash
  const updateHash = (project?: string, session?: string) => {
    if (!browser) return
    const params = new URLSearchParams()
    if (project) params.set('project', project)
    if (session) params.set('session', session)
    const hash = params.toString()
    window.history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname)
  }

  // Restore state from URL hash
  const restoreFromHash = async () => {
    const { project, session } = parseHash()
    if (project) {
      // Expand project and load sessions
      if (!projectSessions.has(project)) {
        loadingProject = project
        try {
          const sessions = await api.listSessions(project)
          projectSessions.set(project, sessions)
          projectSessions = new Map(projectSessions)
        } catch (e) {
          error = String(e)
        } finally {
          loadingProject = null
        }
      }
      expandedProjects.add(project)
      expandedProjects = new Set(expandedProjects)

      // Select session if specified
      if (session) {
        const sessions = projectSessions.get(project)
        const found = sessions?.find((s) => s.id === session)
        if (found) {
          await selectSession(found, false) // Don't update hash again
        }
      }
    }
  }

  onMount(async () => {
    await loadProjects()
    await restoreFromHash()

    // Handle browser back/forward
    window.addEventListener('hashchange', restoreFromHash)
    return () => window.removeEventListener('hashchange', restoreFromHash)
  })

  const loadProjects = async () => {
    loading = true
    error = null
    try {
      projects = await api.listProjects()
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  const toggleProject = async (name: string) => {
    if (expandedProjects.has(name)) {
      expandedProjects.delete(name)
      expandedProjects = new Set(expandedProjects)
      // Update hash: remove project if collapsed
      if (selectedSession?.projectName === name) {
        updateHash() // Clear hash if selected session's project is collapsed
      }
    } else {
      // Load sessions (if not cached)
      if (!projectSessions.has(name)) {
        loadingProject = name
        try {
          const sessions = await api.listSessions(name)
          projectSessions.set(name, sessions)
          projectSessions = new Map(projectSessions)
        } catch (e) {
          error = String(e)
        } finally {
          loadingProject = null
        }
      }
      expandedProjects.add(name)
      expandedProjects = new Set(expandedProjects)
      // Update hash with expanded project
      updateHash(name, selectedSession?.projectName === name ? selectedSession.id : undefined)
    }
  }

  const selectSession = async (session: SessionMeta, shouldUpdateHash = true) => {
    selectedSession = session
    loading = true
    error = null
    try {
      messages = await api.getSession(session.projectName, session.id)
      if (shouldUpdateHash) {
        updateHash(session.projectName, session.id)
      }
    } catch (e) {
      error = String(e)
    } finally {
      loading = false
    }
  }

  const handleDeleteSession = async (e: Event, session: SessionMeta) => {
    e.stopPropagation()
    if (!confirm(`Delete session "${session.title}"?`)) return
    try {
      await api.deleteSession(session.projectName, session.id)
      const sessions = projectSessions.get(session.projectName)
      if (sessions) {
        projectSessions.set(
          session.projectName,
          sessions.filter((s) => s.id !== session.id)
        )
        projectSessions = new Map(projectSessions)
      }
      if (selectedSession?.id === session.id) {
        selectedSession = null
        messages = []
        updateHash(session.projectName) // Keep project expanded, clear session
      }
    } catch (e) {
      error = String(e)
    }
  }

  const handleRenameSession = async (e: Event, session: SessionMeta) => {
    e.stopPropagation()
    const newTitle = prompt('Enter new title:', session.title)
    if (!newTitle) return
    try {
      await api.renameSession(session.projectName, session.id, newTitle)
      session.title = newTitle
      projectSessions = new Map(projectSessions)
    } catch (e) {
      error = String(e)
    }
  }

  const handleDeleteMessage = async (msg: Message) => {
    if (!selectedSession) return
    if (!confirm('Delete this message?')) return
    try {
      await api.deleteMessage(selectedSession.projectName, selectedSession.id, msg.uuid)
      messages = messages.filter((m) => m.uuid !== msg.uuid)
      // Update session message count in sidebar
      const sessions = projectSessions.get(selectedSession.projectName)
      if (sessions) {
        const session = sessions.find((s) => s.id === selectedSession!.id)
        if (session) {
          session.messageCount = messages.length
          projectSessions = new Map(projectSessions)
        }
      }
    } catch (e) {
      error = String(e)
    }
  }

  const handleEditCustomTitle = async (msg: Message) => {
    if (!selectedSession) return
    const currentTitle = (msg as Message & { customTitle?: string }).customTitle ?? ''
    const newTitle = prompt('Enter new custom title:', currentTitle)
    if (newTitle === null || newTitle === currentTitle) return
    try {
      await api.updateCustomTitle(
        selectedSession.projectName,
        selectedSession.id,
        msg.uuid,
        newTitle
      )
      ;(msg as Message & { customTitle?: string }).customTitle = newTitle
      messages = [...messages] // trigger reactivity
    } catch (e) {
      error = String(e)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  const getMessageContent = (msg: Message): string => {
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

  const truncate = (str: string, len: number) =>
    str.length > len ? str.slice(0, len) + '...' : str

  const formatProjectName = (displayName: string) => {
    // /Users/david/Sync/AI -> ~/Sync/AI
    // /Users/david/works/.vscode -> ~/works/.vscode
    return displayName.replace(/^\/Users\/[^/]+/, '~')
  }

  // Filter out empty projects
  const nonEmptyProjects = $derived(projects.filter((p) => p.sessionCount > 0))
</script>

<div class="grid grid-cols-[350px_1fr] gap-4 h-[calc(100vh-120px)]">
  <!-- Sidebar: Projects + Sessions Tree -->
  <aside
    class="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden flex flex-col"
  >
    <h2 class="p-4 text-base font-semibold border-b border-gh-border bg-gh-bg">
      Projects ({nonEmptyProjects.length})
    </h2>
    <ul class="overflow-y-auto flex-1">
      {#each nonEmptyProjects as project}
        <li class="border-b border-gh-border-subtle">
          <button
            class="w-full py-3 px-4 bg-transparent border-none text-gh-text cursor-pointer text-left flex items-center gap-2 font-medium hover:bg-gh-border-subtle {expandedProjects.has(
              project.name
            )
              ? 'bg-gh-accent/10'
              : ''}"
            onclick={() => toggleProject(project.name)}
          >
            <span class="text-xs w-3 text-gh-text-secondary">
              {expandedProjects.has(project.name) ? '▼' : '▶'}
            </span>
            <span
              class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
              title={project.display_name}
            >
              {formatProjectName(project.display_name)}
            </span>
            <span class="bg-gh-border px-2 py-0.5 rounded-full text-xs font-normal">
              {project.sessionCount}
            </span>
          </button>

          {#if expandedProjects.has(project.name)}
            <ul class="bg-gh-bg">
              {#if loadingProject === project.name}
                <li class="py-2 px-8 text-gh-text-secondary text-sm">Loading...</li>
              {:else}
                {#each projectSessions.get(project.name) ?? [] as session}
                  <li
                    class="flex items-center border-t border-gh-border-subtle group {selectedSession?.id ===
                    session.id
                      ? 'bg-gh-accent/20 border-l-3 border-l-gh-accent'
                      : ''}"
                  >
                    <button
                      class="flex-1 min-w-0 py-2 pr-2 bg-transparent border-none text-gh-text cursor-pointer text-left flex items-center gap-2 text-sm hover:bg-gh-border-subtle {selectedSession?.id ===
                      session.id
                        ? 'pl-[calc(2rem-3px)]'
                        : 'pl-8'}"
                      onclick={() => selectSession(session)}
                    >
                      <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                        {session.title ?? 'Untitled'}
                      </span>
                      <span
                        class="flex-shrink-0 text-xs text-gh-text-secondary bg-gh-border px-1.5 py-px rounded-lg"
                      >
                        {session.messageCount}
                      </span>
                    </button>
                    <div
                      class="flex gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <button
                        class="bg-transparent border-none cursor-pointer p-1 rounded hover:bg-gh-border text-xs"
                        onclick={(e) => handleRenameSession(e, session)}
                        title="Rename"
                      >
                        ✏️
                      </button>
                      <button
                        class="bg-transparent border-none cursor-pointer p-1 rounded hover:bg-gh-red/20 text-xs"
                        onclick={(e) => handleDeleteSession(e, session)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </li>
                {/each}
              {/if}
            </ul>
          {/if}
        </li>
      {/each}
    </ul>
  </aside>

  <!-- Right: Messages -->
  <section
    class="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden flex flex-col"
  >
    <div class="p-4 border-b border-gh-border bg-gh-bg">
      {#if selectedSession}
        <h2 class="text-base font-semibold">
          {truncate(selectedSession.title ?? 'Untitled', 50)} ({messages.length} messages)
        </h2>
        <p class="text-xs text-gh-text-secondary font-mono mt-1">{selectedSession.id}</p>
      {:else}
        <h2 class="text-base font-semibold">Messages</h2>
      {/if}
    </div>
    {#if selectedSession}
      <div class="overflow-y-auto flex-1 p-4 flex flex-col gap-4">
        {#each messages as msg}
          {#if msg.type === 'file-history-snapshot'}
            <!-- file-history-snapshot: show tracked file backups -->
            {@const snapshotMsg = msg as unknown as {
              snapshot?: {
                messageId?: string
                trackedFileBackups?: Record
                timestamp?: string
              }
            }}
            {@const backups = snapshotMsg.snapshot?.trackedFileBackups ?? {}}
            {@const files = Object.entries(backups)}
            {#if files.length > 0}
              <div class="p-4 rounded-lg bg-amber-500/10 border-l-3 border-l-amber-500">
                <div class="flex justify-between mb-2 text-xs text-gh-text-secondary">
                  <span class="uppercase font-semibold text-amber-400"
                    >📁 File Backups ({files.length})</span
                  >
                  <span>{formatDate(snapshotMsg.snapshot?.timestamp)}</span>
                </div>
                <ul class="space-y-1">
                  {#each files as [filePath, info]}
                    {@const hasBackup = !!(info.backupFileName && selectedSession?.id)}
                    <li class="font-mono text-xs truncate" title={filePath}>
                      {#if hasBackup}
                        <button
                          class="text-gh-accent hover:underline cursor-pointer bg-transparent border-none p-0"
                          onclick={() =>
                            api.openFileInVscode(selectedSession!.id, info.backupFileName!)}
                          title="Open backup in VS Code"
                        >
                          {filePath}
                        </button>
                      {:else}
                        <span class="text-gh-text-secondary">{filePath}</span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          {:else if msg.type === 'system' && msg.subtype === 'local_command'}
            <!-- local_command: show slash command execution -->
            {@const commandName =
              msg.content?.match(/<command-name>([^<]+)<\/command-name>/)?.[1] ?? ''}
            {@const commandMessage =
              msg.content?.match(/<command-message>([^<]+)<\/command-message>/)?.[1] ?? ''}
            <div class="p-3 rounded-lg bg-cyan-500/10 border-l-3 border-l-cyan-500">
              <div class="flex justify-between items-center text-xs text-gh-text-secondary">
                <span class="font-semibold text-cyan-400">⚡ {commandName || 'Command'}</span>
                <span>{formatDate(msg.timestamp)}</span>
              </div>
              {#if commandMessage && commandMessage !== commandName?.slice(1)}
                <p class="mt-1 text-sm text-gh-text-secondary">{commandMessage}</p>
              {/if}
            </div>
          {:else}
            <div
              class="p-4 rounded-lg group relative {msg.type === 'human'
                ? 'bg-gh-accent/15 border-l-3 border-l-gh-accent'
                : ''} {msg.type === 'assistant'
                ? 'bg-gh-green/15 border-l-3 border-l-gh-green'
                : ''} {msg.type === 'custom-title'
                ? 'bg-purple-500/15 border-l-3 border-l-purple-500'
                : ''} {msg.type !== 'human' &&
              msg.type !== 'assistant' &&
              msg.type !== 'custom-title'
                ? 'bg-gh-border-subtle'
                : ''}"
            >
              <div class="flex justify-between mb-2 text-xs text-gh-text-secondary">
                <span class="uppercase font-semibold">{msg.type}</span>
                <div class="flex items-center gap-2">
                  <span class="group-hover:hidden">{formatDate(msg.timestamp)}</span>
                  <span class="hidden group-hover:inline font-mono text-gh-text-secondary/70"
                    >{msg.uuid}</span
                  >
                  {#if msg.type === 'custom-title'}
                    <button
                      class="opacity-0 group-hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer p-1 rounded hover:bg-gh-border text-xs"
                      onclick={() => handleEditCustomTitle(msg)}
                      title="Edit title"
                    >
                      ✏️
                    </button>
                  {/if}
                  <button
                    class="opacity-0 group-hover:opacity-100 transition-opacity bg-transparent border-none cursor-pointer p-1 rounded hover:bg-gh-red/20 text-xs"
                    onclick={() => handleDeleteMessage(msg)}
                    title="Delete message"
                  >
                    🗑️
                  </button>
                </div>
              </div>
              <div class="whitespace-pre-wrap break-words text-sm">
                {#if msg.type === 'custom-title'}
                  <span class="font-semibold text-purple-400"
                    >{(msg as Message & { customTitle?: string }).customTitle ?? ''}</span
                  >
                {:else}
                  {truncate(getMessageContent(msg), 500)}
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="p-8 text-center text-gh-text-secondary">Select a session</p>
    {/if}
  </section>
</div>

{#if loading}
  <div class="fixed bottom-4 right-4 bg-gh-accent text-white px-4 py-2 rounded">Loading...</div>
{/if}

{#if error}
  <div class="fixed bottom-4 right-4 bg-gh-red text-white px-4 py-2 rounded">
    {error}
  </div>
{/if}
