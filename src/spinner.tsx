import type { Context } from "@opencode/plugin/tui/context"
import { createSignal, onCleanup, onMount } from "solid-js"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Pending(props: { context: Context }) {
  const [frame, setFrame] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % frames.length), 80)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <text fg={props.context.theme.hue.interactive[200]} flexShrink={0}>
      {frames[frame()]} /btw
    </text>
  )
}
