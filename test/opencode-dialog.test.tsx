import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import type { InputRenderable, Renderable, TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { createEffect, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { AnswerDialog, HistoryDialog } from "../src/dialog"
import { Answer } from "../src/answer"
import type { Interaction } from "../src/history"

test.skipIf(!process.env.OPENCODE_SOURCE)("docked answers, palette focus, and dialogs work with OpenCode's real keymap and focus handling", async () => {
  const solid = await import("solid-js")
  const store = await import("solid-js/store")
  Bun.plugin({
    name: "btw-test-shared-solid",
    setup(build) {
      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]dist[/\\]solid\.js$/ }, () => ({ exports: solid, loader: "object" }))
      build.onLoad({ filter: /[/\\]node_modules[/\\]solid-js[/\\]store[/\\]dist[/\\]store\.js$/ }, () => ({ exports: store, loader: "object" }))
    },
  })
  ensureRuntimePluginSupport()
  const root = `${process.env.OPENCODE_SOURCE}/packages/tui`
  const [{ ConfigProvider }, { ThemeProvider, useThemes }, { Keymap }, { DialogProvider, useDialog },
    { ToastProvider }, { TestTuiContexts }, { createTuiResolvedConfig }, { CommandPaletteDialog }] = await Promise.all([
    import(`${root}/src/config/index.tsx`),
    import(`${root}/src/context/theme.tsx`),
    import(`${root}/src/context/keymap.tsx`),
    import(`${root}/src/ui/dialog.tsx`),
    import(`${root}/src/ui/toast.tsx`),
    import(`${root}/test/fixture/tui-environment.tsx`),
    import(`${root}/test/fixture/tui-runtime.ts`),
    import(`${root}/src/component/command-palette.tsx`),
  ])
  const entry = { id: "saved", question: "Saved side question", answer: "An answer.", createdAt: Date.now() }
  let questionsAsked = 0
  let copied = ""
  let show: () => void = () => {}
  let palette: () => void = () => {}
  let prompt: InputRenderable | undefined
  let dialog: { stack: unknown[] } | undefined
  let screen: Awaited<ReturnType<typeof testRender>> | undefined
  function Fixture() {
    const themes = useThemes()
    const host = useDialog()
    const [entryInDock, setEntryInDock] = createSignal<Interaction>()
    const [input, setInput] = createSignal<InputRenderable>()
    const [picker, setPicker] = createStore({ query: "", selected: entry.id })
    dialog = host
    const context = {
      renderer: screen!.renderer,
      get theme() { return themes.currentTokens() },
      keymap: { ...Keymap.use(), ...Keymap.useState(), layer: Keymap.createLayer, shortcuts: Keymap.useShortcuts().list },
      ui: {
        toast: { show() {} },
        dialog: {
          clear: () => host.clear(),
          set(value: { size: string; centered: boolean }) { host.setSize(value.size); host.setCentered(value.centered) },
        },
      },
    } as unknown as Context
    const ask = () => { questionsAsked++ }
    function history() {
      host.replace(() => <HistoryDialog
        context={context} entries={[entry]} state={picker}
        select={(id) => setPicker("selected", id)} search={(query) => setPicker("query", query)}
        open={expand} ask={ask}
      />)
    }
    function expand(value: Interaction) {
      host.replace(() => <AnswerDialog context={context} entry={value} copy={async () => {}} history={history} ask={ask} />)
    }
    show = () => setEntryInDock(entry)
    palette = () => host.replace(() => <CommandPaletteDialog />)
    // Match the main prompt: dialogs temporarily disable it, then restore its focus.
    createEffect(() => {
      const editor = input()
      if (!editor) return
      if (host.stack.length > 0) {
        editor.blur()
        editor.focusable = false
      } else {
        editor.focusable = true
        editor.focus()
      }
    })
    return <box height="100%">
      <text flexGrow={1}>Main conversation</text>
      <box>
        <Show when={entryInDock()} keyed>{(value) => <Answer
          context={context} entry={value} docked copy={async (text) => { copied = text }} history={history} ask={ask}
          back={() => setEntryInDock(undefined)}
          expand={() => expand(value)}
        />}</Show>
      </box>
      <input id="main-prompt" ref={(value) => { prompt = value; setInput(value) }} placeholder="Main session prompt" />
    </box>
  }
  const [ready, setReady] = createSignal(false)
  try {
    screen = await testRender(() => <TestTuiContexts>
      <ConfigProvider config={createTuiResolvedConfig()}>
        <Keymap.Provider>
          <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
            <ToastProvider><DialogProvider>{ready() ? <Fixture /> : null}</DialogProvider></ToastProvider>
          </ThemeProvider>
        </Keymap.Provider>
      </ConfigProvider>
    </TestTuiContexts>, { width: 88, height: 34, kittyKeyboard: true })
    setReady(true)
    screen.renderer.start()
    await screen.waitFor(() => dialog !== undefined)
    show()
    await screen.waitForFrame((frame) => frame.includes("An answer."))
    expect(dialog!.stack).toHaveLength(0)
    expect(screen.renderer.currentFocusedEditor).toBe(prompt!)
    await screen.mockInput.typeText("chxen")
    expect(prompt!.value).toBe("chxen")
    expect(questionsAsked).toBe(0)
    expect(screen.captureCharFrame()).toContain("f6 focus")
    screen.mockInput.pressKey("F6")
    await screen.waitFor(() => screen!.renderer.currentFocusedRenderable?.id === "btw-answer-dock")
    screen.mockInput.pressKey("c")
    await screen.flush()
    expect(copied).toBe(entry.answer)
    expect(prompt!.value).toBe("chxen")
    for (const width of [88, 64, 46, 32, 88]) {
      screen.resize(width, 34)
      await screen.flush()
      const title = screen.renderer.root.findDescendantById("btw-answer-title") as Renderable
      const actions = screen.renderer.root.findDescendantById("btw-answer-actions") as Renderable
      expect(screen.captureCharFrame()).toContain("✓ copied")
      for (const button of actions.getChildren() as TextRenderable[]) {
        expect(screen.captureCharFrame()).toContain(button.plainText)
        expect(button.x + button.width).toBeLessThanOrEqual(width)
        if (button.y === title.y) expect(button.x).toBeGreaterThanOrEqual(title.x + title.width + 2)
      }
    }
    screen.mockInput.pressKey("F6")
    await screen.waitFor(() => screen!.renderer.currentFocusedEditor === prompt)
    palette()
    await screen.waitForFrame((frame) => frame.includes("Commands"))
    await screen.mockInput.typeText("Focus BTW answer")
    await screen.flush()
    screen.mockInput.pressEnter()
    await screen.waitFor(() => screen!.renderer.currentFocusedRenderable?.id === "btw-answer-dock")
    await screen.flush()
    expect(screen.renderer.currentFocusedRenderable?.id).toBe("btw-answer-dock")
    screen.mockInput.pressEscape()
    await screen.flush()
    expect(screen.renderer.currentFocusedEditor).toBe(prompt!)
    const dock = screen.renderer.root.findDescendantById("btw-answer-dock")!
    await screen.mockMouse.click(dock.x, dock.y)
    screen.mockInput.pressKey("n", { ctrl: true })
    await screen.flush()
    expect(questionsAsked).toBe(1)
    await screen.mockMouse.click(dock.x, dock.y)
    screen.mockInput.pressKey("h")
    await screen.waitForFrame((frame) => frame.includes("BTW history"))
    expect(screen.captureCharFrame()).toContain("BTW history")
    const search = screen.renderer.currentFocusedEditor
    screen.mockInput.pressKey("F6")
    await screen.flush()
    expect(screen.renderer.currentFocusedEditor).toBe(search)
    // OpenCode also binds Ctrl+N to dialog.select.next; the BTW action should win.
    screen.mockInput.pressKey("n", { ctrl: true })
    await screen.flush()
    expect(questionsAsked).toBe(2)
    screen.mockInput.pressEnter()
    await screen.waitForFrame((frame) => frame.includes("ctrl+n new question"))
    expect(dialog!.stack).toHaveLength(1)
    expect(screen.renderer.currentFocusedEditor).not.toBe(prompt!)
    screen.mockInput.pressKey("h")
    await screen.waitForFrame((frame) => frame.includes("BTW history"))
    screen.mockInput.pressEnter()
    await screen.waitForFrame((frame) => frame.includes("ctrl+n new question"))
    screen.mockInput.pressEscape()
    await screen.waitFor(() => dialog!.stack.length === 0 && screen!.renderer.currentFocusedEditor === prompt)
    await screen.flush()
    const reopened = screen.renderer.root.findDescendantById("btw-answer-dock")!
    await screen.mockMouse.click(reopened.x, reopened.y)
    screen.mockInput.pressKey("e")
    await screen.waitForFrame((frame) => frame.includes("ctrl+n new question"))
    expect(dialog!.stack).toHaveLength(1)
    screen.mockInput.pressKey("n", { ctrl: true })
    await screen.flush()
    expect(questionsAsked).toBe(3)
    screen.mockInput.pressEscape()
    await screen.waitFor(() => screen!.renderer.currentFocusedEditor === prompt)
    expect(dialog!.stack).toHaveLength(0)
    expect(prompt!.value).toBe("chxen")
    screen.mockInput.pressKey("F6")
    await screen.waitFor(() => screen!.renderer.currentFocusedRenderable?.id === "btw-answer-dock")
    screen.mockInput.pressKey("x")
    await screen.waitFor(() => screen!.renderer.root.findDescendantById("btw-answer-dock") === undefined)
    expect(screen.renderer.currentFocusedEditor).toBe(prompt!)
  } finally {
    screen?.renderer.destroy()
  }
}, 30000)
