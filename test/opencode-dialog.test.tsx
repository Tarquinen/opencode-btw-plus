import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/tui/context"
import { testRender } from "@opentui/solid"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"
import { createSignal } from "solid-js"
import { BtwDialog } from "../src/dialog"

test.skipIf(!process.env.OPENCODE_SOURCE)("answer shortcuts work inside OpenCode's dialog and keymap providers", async () => {
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
    { ToastProvider }, { TestTuiContexts }, { createTuiResolvedConfig }] = await Promise.all([
    import(`${root}/src/config/index.tsx`),
    import(`${root}/src/context/theme.tsx`),
    import(`${root}/src/context/keymap.tsx`),
    import(`${root}/src/ui/dialog.tsx`),
    import(`${root}/src/ui/toast.tsx`),
    import(`${root}/test/fixture/tui-environment.tsx`),
    import(`${root}/test/fixture/tui-runtime.ts`),
  ])
  const entry = { id: "saved", question: "Saved side question", answer: "An answer.", createdAt: Date.now() }
  let show: () => void = () => {}
  let dialog: { stack: unknown[] } | undefined
  let screen: Awaited<ReturnType<typeof testRender>> | undefined
  function Fixture() {
    const themes = useThemes()
    const host = useDialog()
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
    show = () => host.replace(() => <BtwDialog context={context} entries={[entry]} initialAnswer={entry} copy={async () => {}} ask={() => {}} />)
    return null
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
    expect(screen.captureCharFrame()).toContain("h history")
    screen.mockInput.pressKey("h")
    await screen.waitForFrame((frame) => frame.includes("BTW history"))
    expect(screen.captureCharFrame()).toContain("BTW history")
    screen.mockInput.pressEnter()
    await screen.waitForFrame((frame) => frame.includes("An answer."))
    expect(screen.captureCharFrame()).toContain("h history")
    screen.mockInput.pressEscape()
    await screen.flush()
    expect(screen.captureCharFrame()).toContain("BTW history")
    expect(dialog!.stack).toHaveLength(1)
  } finally {
    screen?.renderer.destroy()
  }
}, 30000)
