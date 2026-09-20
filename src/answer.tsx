import type { Context } from "@opencode/plugin/tui/context"
import { generateSyntax } from "@opencode/theme/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup } from "solid-js"
import type { Interaction } from "./history"

export function Answer(props: {
  context: Context
  entry: Interaction
  copy: (text: string) => Promise<void>
  back: () => void
  history: () => void
  ask: () => void
}) {
  const context = props.context
  const theme = () => context.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const [copied, setCopied] = createSignal(false)
  const syntax = createMemo(() => {
    const style = generateSyntax(context.theme)
    onCleanup(() => style.destroy())
    return style
  })
  let scroll: ScrollBoxRenderable | undefined

  async function copy() {
    try {
      await props.copy(props.entry.answer)
      setCopied(true)
    } catch (error) {
      context.ui.toast.show({ message: String(error), variant: "error" })
    }
  }

  context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { bind: "c", title: "Copy answer", run: copy },
      { bind: "h", title: "BTW history", run: props.history },
      { id: "btw-plus.new", bind: "ctrl+n", title: "Ask a new question", run: props.ask },
      {
        bind: "escape",
        title: "Back",
        run() {
          if (context.renderer.getSelection()) {
            context.renderer.clearSelection()
            return
          }
          props.back()
        },
      },
      { bind: "up", run: () => { scroll?.scrollBy(-1) } },
      { bind: "down", run: () => { scroll?.scrollBy(1) } },
      { bind: "pageup", run: () => { scroll?.scrollBy(-20) } },
      { bind: "pagedown", run: () => { scroll?.scrollBy(20) } },
      { bind: "home", run: () => { scroll?.scrollTo(0) } },
      { bind: "end", run: () => { if (scroll) scroll.scrollTo(scroll.scrollHeight) } },
    ],
  }))

  return (
    <box gap={1}>
      <box paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme().text.base}>/btw</text>
          <text fg={theme().text.muted} onMouseUp={props.back}>esc</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme().text.muted} wrapMode="word">{props.entry.question}</text>
        </box>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={Math.max(3, Math.min(20, dimensions().height - 10))}
        backgroundColor={context.theme.background.raised.high}
        scrollbarOptions={{ visible: false }}
      >
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <markdown
            syntaxStyle={syntax()}
            content={props.entry.answer}
            conceal
            internalBlockMode="top-level"
            tableOptions={{ style: "grid", cellPaddingX: 1 }}
            fg={context.theme.markdown.text}
            bg={context.theme.background.raised.high}
          />
        </box>
      </scrollbox>
      <box flexDirection="row" flexWrap="wrap" gap={3} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text onMouseUp={() => void copy()}>
          <span style={{ fg: copied() ? theme().text.feedback.success.base : theme().text.base }}>
            <b>{copied() ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme().text.muted }}>{copied() ? "" : " copy"}</span>
        </text>
        <text onMouseUp={props.history} fg={theme().text.muted}><b>h</b> history</text>
        <text onMouseUp={props.ask} fg={theme().text.muted}>
          <b>{context.keymap.shortcuts("btw-plus.new")[0] ?? "ctrl+n"}</b> new question
        </text>
        <text fg={theme().text.muted}>↑/↓ scroll</text>
      </box>
    </box>
  )
}
