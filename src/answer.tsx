import type { Context } from "@opencode/plugin/tui/context"
import { generateSyntax } from "@opencode/theme/tui"
import { CliRenderEvents, TextAttributes, type BoxRenderable, type Renderable, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import stringWidth from "string-width"
import type { Interaction } from "./history"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function Answer(props: {
  context: Context
  entry: Interaction
  copy: (text: string) => Promise<void>
  back: () => void
  history: () => void
  ask: () => void
  docked?: boolean
  expand?: () => void
}) {
  const context = props.context
  const theme = () => props.docked ? context.theme : context.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const padding = () => props.docked && dimensions().width < 44 ? 1 : 2
  const background = () => props.docked ? theme().decrease(theme().background.raised.base) : theme().background.raised.high
  const [copied, setCopied] = createSignal(false)
  const [box, setBox] = createSignal<BoxRenderable>()
  const [focused, setFocused] = createSignal(false)
  const shortcuts = () => !props.docked || focused()
  let previousFocus: Renderable | null = null
  const syntax = createMemo(() => {
    const style = generateSyntax(context.theme)
    onCleanup(() => style.destroy())
    return style
  })
  let scroll: ScrollBoxRenderable | undefined

  function focus() {
    if (box()?.focused) return
    previousFocus = context.renderer.currentFocusedRenderable
    box()?.focus()
  }

  function releaseFocus() {
    if (!box()?.focused) return
    box()?.blur()
    if (previousFocus && !previousFocus.isDestroyed) previousFocus.focus()
  }

  function leave(action: () => void) {
    releaseFocus()
    action()
  }

  if (props.docked) {
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    const trackFocus = () => setFocused(context.renderer.currentFocusedRenderable === box())
    context.renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, trackFocus)
    onCleanup(() => {
      context.renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, trackFocus)
      clearTimeout(focusTimer)
      releaseFocus()
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "btw-plus.focus", title: "Focus BTW answer", group: "Session", palette: true,
        bind: "f6",
        run() {
          if (context.keymap.mode.current() !== "base") return false
          clearTimeout(focusTimer)
          if (box()?.focused) {
            releaseFocus()
            return
          }
          // Let the command palette restore prompt focus before moving it into the answer.
          focusTimer = setTimeout(focus, 1)
        },
      }],
    }))
  }

  async function copy() {
    try {
      await props.copy(props.entry.answer)
      setCopied(true)
    } catch (error) {
      context.ui.toast.show({ message: String(error), variant: "error" })
    }
  }

  context.keymap.layer(() => ({
    mode: props.docked ? "base" : "modal",
    target: props.docked ? box : undefined,
    commands: [
      { bind: "c", title: "Copy answer", run: copy },
      { bind: "h", title: "BTW history", run: () => leave(props.history) },
      { id: "btw-plus.new", bind: "ctrl+n", title: "Ask a new question", run: () => leave(props.ask) },
      ...(props.docked ? [
        { bind: "e", title: "Expand answer", run: () => leave(() => props.expand?.()) },
        { bind: "x", title: "Close answer", run: () => leave(props.back) },
        { bind: "tab", title: "Return to prompt", run: releaseFocus },
      ] : []),
      {
        bind: "escape",
        title: "Back",
        run() {
          if (context.renderer.getSelection()) {
            context.renderer.clearSelection()
            return
          }
          if (props.docked) releaseFocus()
          else props.back()
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

  // Keep the original modal layout independent of the compact dock's styling.
  if (!props.docked) {
    return (
      <box id="btw-answer-expanded" gap={1}>
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

  const [questionWidth, setQuestionWidth] = createSignal(0)
  const [moreBelow, setMoreBelow] = createSignal(false)
  const question = createMemo(() => {
    const text = " · " + props.entry.question.replace(/\s+/g, " ")
    const width = questionWidth()
    if (width <= 0) return ""
    if (stringWidth(text) <= width) return text
    // OpenTUI's native truncation removes the middle. Keep the question's beginning instead.
    let prefix = ""
    let used = 0
    for (const { segment } of graphemes.segment(text)) {
      const size = stringWidth(segment)
      if (used + size > width - 1) break
      prefix += segment
      used += size
    }
    return prefix.trimEnd() + "…"
  })

  return (
    <box
      id="btw-answer-dock"
      ref={setBox}
      focusable
      onMouseDown={focus}
      backgroundColor={background()}
      paddingLeft={1}
      paddingTop={1}
      marginBottom={1}
      flexShrink={0}
    >
      <box paddingLeft={padding()} paddingRight={padding()}>
        <box id="btw-answer-header" flexDirection="row" flexWrap="wrap" columnGap={2} justifyContent="space-between">
          <box
            id="btw-answer-title"
            ref={(element: BoxRenderable) => setQuestionWidth(element.width - 4)}
            onSizeChange={function () { setQuestionWidth(this.width - 4) }}
            flexDirection="row" flexGrow={1} flexShrink={1} flexBasis={24} minWidth={0} maxWidth="100%" overflow="hidden"
          >
            <text attributes={TextAttributes.BOLD} fg={theme().text.base} flexShrink={0}>/btw</text>
            <text
              id="btw-answer-question"
              fg={theme().text.muted} flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} height={1} wrapMode="none"
            >
              {question()}
            </text>
          </box>
          <box
            id="btw-answer-actions"
            flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={1} maxWidth="100%"
            onMouseDown={(event) => {
              // Clicking an action should not move focus or change its label before mouse-up.
              event.preventDefault()
              event.stopPropagation()
            }}
          >
            <text flexShrink={0} height={1} wrapMode="none" onMouseUp={() => void copy()} fg={copied() ? theme().text.feedback.success.base : theme().text.muted}>
              {copied() ? "✓ copied" : shortcuts() ? "c copy" : "Copy"}
            </text>
            <text flexShrink={0} height={1} wrapMode="none" onMouseUp={() => leave(props.history)} fg={theme().text.muted}>{shortcuts() ? "h history" : "History"}</text>
            <text flexShrink={0} height={1} wrapMode="none" onMouseUp={() => leave(() => props.expand?.())} fg={theme().text.muted}>{shortcuts() ? "e expand" : "Expand"}</text>
            <text flexShrink={0} height={1} wrapMode="none" onMouseUp={() => leave(props.back)} fg={theme().text.muted}>{shortcuts() ? "x close" : "Close"}</text>
          </box>
        </box>
      </box>
      <scrollbox
        id="btw-answer-body"
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        renderAfter={function (this: ScrollBoxRenderable) {
          // Check the laid-out Markdown so wrapping, resizing, and mouse scrolling stay in sync.
          setMoreBelow(this.scrollTop + this.viewport.height < this.scrollHeight)
        }}
        maxHeight={Math.max(2, Math.min(6, Math.floor(dimensions().height / 3) - 4))}
        flexGrow={0}
        flexShrink={0}
        contentOptions={{ minHeight: 0 }}
        backgroundColor={background()}
        scrollbarOptions={{ visible: false }}
      >
        <box paddingLeft={padding()} paddingRight={padding()}>
          <markdown
            syntaxStyle={syntax()}
            content={props.entry.answer}
            conceal
            internalBlockMode="top-level"
            tableOptions={{ style: "grid", cellPaddingX: 1 }}
            fg={context.theme.markdown.text}
            bg={background()}
          />
        </box>
      </scrollbox>
      <box
        flexDirection="row" flexWrap="wrap" gap={2}
        paddingLeft={padding()} paddingRight={padding()}
        onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }}
      >
        <Show when={!focused() && moreBelow()}>
          <text id="btw-answer-more" fg={theme().text.muted}>↓ more</text>
        </Show>
        <Show when={shortcuts()}>
          <text onMouseUp={() => leave(props.ask)} fg={theme().text.muted}>
            <b>{context.keymap.shortcuts("btw-plus.new")[0] ?? "ctrl+n"}</b> new question
          </text>
          <text fg={theme().text.muted}>↑/↓ scroll</text>
        </Show>
        <text marginLeft="auto" fg={theme().text.muted} onMouseUp={() => focused() ? releaseFocus() : focus()}>
          {focused() ? "esc prompt" : `${context.keymap.shortcuts("btw-plus.focus")[0] ?? "f6"} focus`}
        </text>
      </box>
    </box>
  )
}
