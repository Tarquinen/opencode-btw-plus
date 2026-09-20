import type { Context } from "@opencode/plugin/tui/context"
import { CliRenderEvents, RGBA, TextAttributes, type InputRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, For, onCleanup, onMount, Show } from "solid-js"
import { dateGroup, searchHistory, type Interaction } from "./history"

const transparent = RGBA.fromInts(0, 0, 0, 0)

export interface PickerState {
  query: string
  selected: string
}

export function HistoryPicker(props: {
  context: Context
  entries: readonly Interaction[]
  state: PickerState
  select: (id: string) => void
  search: (query: string) => void
  open: (entry: Interaction) => void
  ask: () => void
}) {
  const context = props.context
  const theme = () => context.theme.surface("dialog")
  const dimensions = useTerminalDimensions()
  const entries = createMemo(() => searchHistory(props.entries, props.state.query))
  const ids = createMemo(() => {
    const result = ["new"]
    for (const entry of entries()) result.push(entry.id)
    return result
  })
  const selected = () => ids().includes(props.state.selected) ? props.state.selected : ids()[0]
  let input: InputRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  let afterFrame: (() => void) | undefined

  function scrollToSelection() {
    if (!scroll) return
    const row = scroll.getChildren().find((child) => child.id === `btw-${selected()}`)
    if (!row) return
    const offset = row.y - scroll.y
    if (offset < 0) scroll.scrollBy(offset)
    else if (offset >= scroll.height) scroll.scrollBy(offset - scroll.height + 1)
    if (selected() === "new") scroll.scrollTo(0)
  }

  createEffect(() => {
    selected()
    entries()
    dimensions()
    if (afterFrame) context.renderer.off(CliRenderEvents.FRAME, afterFrame)
    afterFrame = () => {
      afterFrame = undefined
      scrollToSelection()
    }
    context.renderer.once(CliRenderEvents.FRAME, afterFrame)
    context.renderer.requestRender()
  })
  onCleanup(() => {
    if (afterFrame) context.renderer.off(CliRenderEvents.FRAME, afterFrame)
  })
  onMount(() => input?.focus())

  function move(delta: number) {
    const items = ids()
    const index = items.indexOf(selected())
    props.select(items[((index + delta) % items.length + items.length) % items.length])
  }

  function submit() {
    if (selected() === "new") {
      props.ask()
      return
    }
    const entry = entries().find((item) => item.id === selected())
    if (entry) props.open(entry)
  }

  context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      // Put this first so it wins over OpenCode's Ctrl+N binding for the next item.
      { id: "btw-plus.new", bind: "ctrl+n", title: "Ask a new question", run: props.ask },
      // Reuse the picker command IDs so user keybinds and Vim navigation work here too.
      { id: "dialog.select.prev", bind: "up", title: "Previous item", run: () => move(-1) },
      { id: "dialog.select.next", bind: "down", title: "Next item", run: () => move(1) },
      { id: "dialog.select.page_up", bind: "pageup", title: "Page up", run: () => move(-10) },
      { id: "dialog.select.page_down", bind: "pagedown", title: "Page down", run: () => move(10) },
      { id: "dialog.select.home", bind: "home", title: "First item", run: () => props.select("new") },
      { id: "dialog.select.end", bind: "end", title: "Last item", run: () => props.select(ids().at(-1)!) },
      { id: "dialog.select.submit", bind: "return", title: "Open answer", run: submit },
    ],
  }))

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme().text.base} attributes={TextAttributes.BOLD}>BTW history</text>
          <text fg={theme().text.muted} onMouseUp={() => context.ui.dialog.clear()}>esc</text>
        </box>
        <box paddingTop={1}>
          <input
            ref={(element) => {
              input = element
              input.traits = { status: "FILTER" }
            }}
            value={props.state.query}
            onInput={(query) => {
              // Restoring the input also emits onInput; keep the previous selection in that case.
              if (query === props.state.query) return
              props.search(query)
              props.select(entries()[0]?.id ?? "new")
            }}
            placeholder="Search questions and answers"
            placeholderColor={theme().text.muted}
            focusedBackgroundColor={theme().background.formfield.focused}
            focusedTextColor={theme().text.formfield.focused}
            cursorColor={theme().text.formfield.focused}
          />
        </box>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={Math.max(3, Math.floor(dimensions().height / 2) - 6)}
        paddingLeft={1}
        paddingRight={1}
        scrollbarOptions={{ visible: false }}
      >
        <box
          id="btw-new"
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={selected() === "new" ? theme().background.action.primary.focused : transparent}
          onMouseMove={() => props.select("new")}
          onMouseUp={props.ask}
        >
          <text fg={selected() === "new" ? theme().text.action.primary.focused : theme().text.base}>
            + Ask a new question
          </text>
        </box>
        <For each={entries()}>
          {(entry, index) => {
            const category = () => dateGroup(entry.createdAt)
            const active = () => selected() === entry.id
            return (
              <>
                <Show when={index() === 0 || category() !== dateGroup(entries()[index() - 1].createdAt)}>
                  <box paddingTop={1} paddingLeft={3}>
                    <text fg={theme().hue.accent[200]} attributes={TextAttributes.BOLD}>{category()}</text>
                  </box>
                </Show>
                <box
                  id={`btw-${entry.id}`}
                  flexDirection="row"
                  paddingLeft={3}
                  paddingRight={3}
                  gap={1}
                  backgroundColor={active() ? theme().background.action.primary.focused : transparent}
                  onMouseMove={() => props.select(entry.id)}
                  onMouseUp={() => {
                    props.select(entry.id)
                    props.open(entry)
                  }}
                >
                  <text
                    flexGrow={1}
                    flexShrink={1}
                    height={1}
                    wrapMode="none"
                    truncate
                    fg={active() ? theme().text.action.primary.focused : theme().text.base}
                  >
                    {entry.question.replace(/\s+/g, " ")}
                  </text>
                  <text flexShrink={0} fg={active() ? theme().text.action.primary.focused : theme().text.muted}>
                    {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </text>
                </box>
              </>
            )
          }}
        </For>
        <Show when={entries().length === 0}>
          <box paddingLeft={3} paddingRight={3} paddingTop={1}>
            <text fg={theme().text.muted}>
              {props.state.query ? "No matching questions" : "No questions in this session yet"}
            </text>
          </box>
        </Show>
      </scrollbox>
      <box flexDirection="row" flexWrap="wrap" gap={3} paddingLeft={4} paddingRight={4}>
        <text fg={theme().text.muted}>↑/↓ select</text>
        <text fg={theme().text.muted} onMouseUp={submit}><b>enter</b> open</text>
        <text fg={theme().text.muted} onMouseUp={props.ask}>
          <b>{context.keymap.shortcuts("btw-plus.new")[0] ?? "ctrl+n"}</b> new question
        </text>
      </box>
    </box>
  )
}
