<script lang="ts">
  import type { Message, SessionMeta } from '$lib/api'
  import { truncate } from '$lib/utils'
  import MessageItem from './MessageItem.svelte'

  interface Props {
    session: SessionMeta | null
    messages: Message[]
    onDeleteMessage: (msg: Message) => void
    onEditTitle: (msg: Message) => void
  }

  let { session, messages, onDeleteMessage, onEditTitle }: Props = $props()
</script>

<section
  class="bg-gh-bg-secondary border border-gh-border rounded-lg overflow-hidden flex flex-col"
>
  <!-- Header -->
  <div class="p-4 border-b border-gh-border bg-gh-bg">
    {#if session}
      <h2 class="text-base font-semibold">
        {truncate(session.title ?? 'Untitled', 50)} ({messages.length} messages)
      </h2>
      <p class="text-xs text-gh-text-secondary font-mono mt-1">{session.id}</p>
    {:else}
      <h2 class="text-base font-semibold">Messages</h2>
    {/if}
  </div>

  <!-- Messages -->
  {#if session}
    <div class="overflow-y-auto flex-1 p-4 flex flex-col gap-4">
      {#each messages as msg, i (msg.uuid ?? `idx-${i}`)}
        <MessageItem {msg} sessionId={session.id} onDelete={onDeleteMessage} {onEditTitle} />
      {/each}
    </div>
  {:else}
    <p class="p-8 text-center text-gh-text-secondary">Select a session</p>
  {/if}
</section>
