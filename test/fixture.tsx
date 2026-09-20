import { afterAll, afterEach, beforeAll, mock } from "bun:test"
import type { SessionInboxInfo } from "@opencode/client"
import type { Context, DialogOptions, KeymapCommand, Route, ToastOptions } from "@opencode/plugin/tui/context"
import { resolveTheme } from "@opencode/theme/tui"
import { destroyTreeSitterClient, getTreeSitterClient, type InputRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider, useBindings } from "@opentui/keymap/solid"
import { render, type JSX } from "@opentui/solid"
import { createEffect, createSignal, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import plugin from "../tui"
import type { History } from "../src/history"

const scale = {
  100: "#ffffff", 200: "#dddddd", 300: "#bbbbbb", 400: "#999999", 500: "#777777",
  600: "#555555", 700: "#333333", 800: "#222222", 900: "#111111",
}
const foreground = { base: "#dddddd", $focused: "#111111" }
const background = { base: "#222222", $focused: "#aaaaee" }
const feedback = { base: "#99ccff", muted: "#667799" }
const theme = resolveTheme({
  hue: {
    gray: scale, red: scale, orange: scale, yellow: scale, green: scale, cyan: scale, blue: scale, purple: scale,
    accent: "$hue.blue", interactive: "$hue.blue", neutral: "$hue.gray",
  },
  categorical: ["blue", "cyan"],
  text: {
    base: "#dddddd", muted: "#888888", formfield: foreground,
    action: { primary: foreground, secondary: foreground, destructive: foreground },
    feedback: { success: feedback, error: feedback, warning: feedback, info: feedback },
  },
  background: {
    base: "#111111", raised: { base: "#222222", high: "#333333", max: "#444444" }, formfield: background,
    action: { primary: background, secondary: background, destructive: background },
    feedback: { success: background, error: background, warning: background, info: background },
  },
  border: { base: "#555555" }, scrollbar: { base: "#777777" },
  diff: {
    text: { added: "#dddddd", removed: "#dddddd", context: "#dddddd", hunkHeader: "#dddddd" },
    background: { added: "#222222", removed: "#222222", context: "#222222" },
    highlight: { added: "#555555", removed: "#555555" },
    lineNumber: { text: "#888888", background: { added: "#222222", removed: "#222222" } },
  },
  syntax: {
    comment: "#888888", keyword: "#99ccff", function: "#99ccff", variable: "#dddddd", string: "#99ccff",
    number: "#99ccff", type: "#99ccff", operator: "#dddddd", punctuation: "#dddddd",
  },
  markdown: {
    text: "#dddddd", heading: "#99ccff", link: "#99ccff", linkText: "#99ccff", code: "#99ccff",
    blockQuote: "#888888", emphasis: "#dddddd", strong: "#dddddd", horizontalRule: "#888888",
    listItem: "#99ccff", listEnumeration: "#99ccff", image: "#99ccff", imageText: "#99ccff", codeBlock: "#99ccff",
  },
})

const cleanups: Array<() => void | Promise<void>> = []
beforeAll(async () => { await getTreeSitterClient().preloadParser("markdown") })
afterAll(async () => { await destroyTreeSitterClient() })
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
})

export function tempStorage() {
  const directory = mkdtempSync("/tmp/opencode/btw-plus-")
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

export async function mount(options: {
  directory?: string
  sessionID?: string
  prompt?: string
  failWrite?: boolean
  generate?: (input: { sessionID: string; prompt: string }) => Promise<{ text: string }>
} = {}) {
  const directory = options.directory ?? tempStorage()
  const screen = await createTestRenderer({ width: 88, height: 34, kittyKeyboard: true })
  const keymap = createDefaultOpenTuiKeymap(screen.renderer)
  const [dialog, setDialog] = createSignal<(() => JSX.Element) | undefined>()
  const [route, setRoute] = createSignal<Route>({ type: "session", sessionID: options.sessionID ?? "ses_one" })
  const [pendingInputs, setPendingInputs] = createStore<Record<string, SessionInboxInfo[]>>({})
  const toasts: ToastOptions[] = []
  const prompts: string[] = []
  const commands = new Map<string, KeymapCommand>()
  const stores = new Map<string, ReturnType<typeof createStore<History>>>()
  const slots = new Map<string, Array<(input: { sessionID: string }) => JSX.Element>>()
  const [prompt, setPrompt] = createSignal<InputRenderable>()
  const generate = mock(options.generate ?? (async () => ({ text: "A concise **answer**." })))
  let presentation: DialogOptions = {}
  let dispose: (() => void | Promise<void>) | undefined

  const context = {
    options: {},
    renderer: screen.renderer,
    theme,
    client: { session: { generate } },
    data: { session: { pending: { list: (sessionID: string) => pendingInputs[sessionID] ?? [] } } },
    storage: {
      store(key: string, config: { initial: History }) {
        const file = `${directory}/${key}.json`
        let saved = stores.get(key)
        if (!saved) {
          let initial = config.initial
          try { initial = JSON.parse(readFileSync(file, "utf8")) } catch {}
          saved = createStore<History>(initial)
          stores.set(key, saved)
        }
        const [state, setState] = saved
        return [state, async (mutation: (draft: History) => void) => {
          if (options.failWrite) throw new Error("Disk full")
          const draft = JSON.parse(JSON.stringify(state)) as History
          mutation(draft)
          writeFileSync(file, JSON.stringify(draft))
          setState(reconcile(draft))
        }]
      },
    },
    keymap: {
      mode: { current: () => dialog() ? "modal" : "base" },
      layer(input: Parameters<Context["keymap"]["layer"]>[0]) {
        useBindings(() => {
          const layer = input()
          const named = []
          const bindings = []
          for (const command of layer.commands ?? []) {
            if (command.id) {
              if (command.palette) commands.set(command.id, command)
              named.push({ name: command.id, run: () => command.run() })
            }
            if (command.bind) bindings.push({ key: command.bind, cmd: command.id ?? (() => command.run()) })
          }
          const enabled = layer.mode === "modal" ? Boolean(dialog()) : layer.mode === "base" ? !dialog() : true
          return { commands: named, bindings, priority: layer.priority, target: layer.target, enabled }
        })
      },
      shortcuts: () => [],
    },
    ui: {
      router: { current: route },
      toast: { show: (toast: ToastOptions) => toasts.push(toast) },
      slot(claim: { append: string; render: (input: { sessionID: string }) => JSX.Element }) {
        const list = slots.get(claim.append) ?? []
        list.push(claim.render)
        slots.set(claim.append, list)
        return () => {}
      },
      dialog: {
        show(view: () => JSX.Element) { setDialog(() => view) },
        set(value: DialogOptions) { presentation = value },
        clear() { setDialog(undefined) },
        async prompt({ title }: { title: string }) {
          prompts.push(title)
          setDialog(undefined)
          return options.prompt
        },
      },
    },
  } as unknown as Context

  function submitMessage(text: string, sessionID: string) {
    const item: SessionInboxInfo = {
      id: crypto.randomUUID(), sessionID, type: "user", payload: { text }, delivery: "steer", time: { created: Date.now() },
    }
    setPendingInputs(sessionID, [...(pendingInputs[sessionID] ?? []), item])
    return item
  }

  function Fixture() {
    // The host's Escape layer is installed before the plugin's modal layers.
    useBindings(() => ({ enabled: Boolean(dialog()), bindings: [{ key: "escape", cmd: () => context.ui.dialog.clear() }] }))
    dispose = plugin.setup(context) as () => void | Promise<void>
    createEffect(() => {
      if (dialog()) prompt()?.blur()
      else prompt()?.focus()
    })
    function renderSlots(path: string, sessionID: string) {
      return slots.get(path)?.map((slot) => <box>{slot({ sessionID })}</box>)
    }
    const sessionID = () => {
      const current = route()
      return current.type === "session" ? current.sessionID : undefined
    }
    return <box height="100%">
      {renderSlots("app", "")}
      <text flexGrow={1}>Main conversation</text>
      <Show when={sessionID()} keyed>
        {(id) => <box flexShrink={0}>
          {renderSlots("session.composer.top", id)}
          <input id="main-prompt" ref={setPrompt} placeholder="Main session prompt" onSubmit={() => {
            const text = prompt()!.value
            if (!text.trim()) return
            submitMessage(text, id)
            prompt()!.value = ""
          }} />
          {renderSlots("prompt.footer.status", id)}
        </box>}
      </Show>
      <Show when={dialog()}><box position="absolute" width="100%" backgroundColor={theme.background.base}>{dialog()?.()}</box></Show>
    </box>
  }
  await render(() => <KeymapProvider keymap={keymap}><Fixture /></KeymapProvider>, screen.renderer)
  screen.renderer.start()
  await screen.flush()
  let closed = false
  async function close() {
    if (closed) return
    closed = true
    await dispose?.()
    screen.renderer.destroy()
  }
  cleanups.push(close)
  return {
    ...screen, context, generate, toasts, prompts, close, directory, setRoute, prompt, dialog, submitMessage, setPendingInputs,
    focusAnswer: async () => {
      commands.get("btw-plus.focus")!.run()
      await screen.waitFor(() => screen.renderer.currentFocusedRenderable?.id === "btw-answer-dock")
    },
    presentation: () => presentation,
    invoke: async (input?: string) => { await commands.get("session.aside")!.run(input); await screen.flush() },
    saved: (sessionID = "ses_one"): History => JSON.parse(readFileSync(`${directory}/session.${sessionID}.json`, "utf8")),
  }
}
