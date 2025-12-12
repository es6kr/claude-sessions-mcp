<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import * as api from '$lib/api'

  let { children }: { children: Snippet } = $props()

  let version = $state('')
  let cleaning = $state(false)
  let cleanupResult = $state<{
    success: boolean
    deletedCount: number
    removedMessageCount: number
  } | null>(null)

  onMount(async () => {
    try {
      const res = await api.getVersion()
      version = res.version
    } catch {
      version = 'unknown'
    }
  })

  const handleCleanup = async () => {
    const preview = await api.previewCleanup()
    const totalEmpty = preview.reduce((sum, p) => sum + p.emptySessions.length, 0)

    if (totalEmpty === 0) {
      alert('No empty sessions found')
      return
    }

    if (!confirm(`Delete ${totalEmpty} empty sessions?`)) return

    cleaning = true
    try {
      cleanupResult = await api.clearSessions({ clearEmpty: true, clearInvalid: false })
      setTimeout(() => {
        cleanupResult = null
        window.location.reload()
      }, 2000)
    } catch (e) {
      alert(`Error: ${e}`)
    } finally {
      cleaning = false
    }
  }
</script>

<svelte:head>
  <title>Claude Session Manager</title>
</svelte:head>

<div class="min-h-screen flex flex-col bg-gh-bg text-gh-text">
  <header
    class="bg-gh-bg-secondary border-b border-gh-border px-8 py-4 flex justify-between items-center"
  >
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">Claude Session Manager</h1>
      {#if version}
        <span class="text-xs text-gh-text-secondary bg-gh-border px-2 py-0.5 rounded"
          >v{version}</span
        >
      {/if}
    </div>
    <div class="flex gap-2">
      <button
        class="bg-gh-border-subtle border border-gh-border text-gh-text px-4 py-2 rounded-md text-sm transition-colors hover:bg-gh-border hover:border-gh-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={handleCleanup}
        disabled={cleaning}
      >
        {cleaning ? 'Cleaning...' : 'Clear Empty Sessions'}
      </button>
    </div>
  </header>

  <main class="flex-1 p-8 max-w-7xl mx-auto w-full">
    {@render children()}
  </main>
</div>

{#if cleanupResult}
  <div class="fixed bottom-4 right-4 bg-gh-green text-white px-5 py-3 rounded-md text-sm z-50">
    {#if cleanupResult.removedMessageCount > 0}
      Removed {cleanupResult.removedMessageCount} invalid messages.
    {/if}
    Deleted {cleanupResult.deletedCount} empty sessions.
  </div>
{/if}
