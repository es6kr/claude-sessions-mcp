<script lang="ts">
  interface Props {
    content: string
    maxLines?: number
  }

  let { content, maxLines = 10 }: Props = $props()

  let expanded = $state(false)
  let isHovering = $state(false)

  const lines = $derived(content.split('\n'))
  const needsExpand = $derived(lines.length > maxLines)
  const displayContent = $derived(
    needsExpand && !expanded ? lines.slice(0, maxLines).join('\n') : content
  )
</script>

<div
  class="relative"
  onmouseenter={() => (isHovering = true)}
  onmouseleave={() => (isHovering = false)}
>
  <pre
    class="whitespace-pre-wrap font-mono text-xs text-gh-text-secondary overflow-x-auto">{displayContent}</pre>
  {#if needsExpand && !expanded}
    <div
      class="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gh-canvas to-transparent pointer-events-none"
    ></div>
    {#if isHovering}
      <button
        class="absolute bottom-1 left-1/2 -translate-x-1/2 px-3 py-1 text-xs bg-gh-border hover:bg-gh-border-muted rounded-full cursor-pointer border-none text-gh-text-secondary transition-all"
        onclick={() => (expanded = true)}
      >
        Click to expand ({lines.length - maxLines} more lines)
      </button>
    {/if}
  {/if}
  {#if expanded && needsExpand}
    <button
      class="mt-2 px-3 py-1 text-xs bg-gh-border hover:bg-gh-border-muted rounded-full cursor-pointer border-none text-gh-text-secondary"
      onclick={() => (expanded = false)}
    >
      Collapse
    </button>
  {/if}
</div>
