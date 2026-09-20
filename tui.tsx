import { Plugin } from "@opencode/plugin/tui"
import { createClipboard, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core"
import { createSignal, Show } from "solid-js"
import { BtwDialog } from "./src/dialog"
import type { History, Interaction } from "./src/history"
import { Pending } from "./src/spinner"

// Match the built-in /btw: one transient generation, no tool loop or session messages.
const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

export default Plugin.define({
  id: "btw-plus",
  setup(context) {
    const [pending, setPending] = createSignal(0)
    let active = true
    let clipboard: ReturnType<typeof createClipboard> | undefined

    function history(sessionID: string) {
      return context.storage.store<History>(`session.${sessionID}`, { initial: { entries: [] } })
    }

    async function copy(text: string) {
      clipboard ??= createClipboard({
        host: createHostClipboard(),
        terminal: createRendererClipboardAdapter(context.renderer),
      })
      const result = await clipboard.writeText(text.replaceAll("\0", ""), { destination: "all-available" })
      if (result.host.status === "written" || result.terminal.status === "attempted") return
      if (result.host.status === "failed") throw result.host.error
      throw new Error("Could not copy the answer to the clipboard")
    }

    function show(sessionID: string, answer?: Interaction) {
      const [saved] = history(sessionID)
      context.ui.dialog.show(() => (
        <BtwDialog
          context={context}
          entries={saved.entries}
          initialAnswer={answer}
          ask={() => { void ask(sessionID) }}
          copy={copy}
        />
      ))
    }

    async function ask(sessionID: string, input?: string) {
      const question = (input ?? await context.ui.dialog.prompt({ title: "/btw", placeholder: "Ask anything" }))?.trim()
      if (!question || !active) return
      const createdAt = Date.now()
      setPending((count) => count + 1)
      try {
        const result = await context.client.session.generate({ sessionID, prompt: [instructions, question].join("\n\n") })
        const entry: Interaction = { id: crypto.randomUUID(), question, answer: result.text.trim(), createdAt }
        const [, update] = history(sessionID)
        try {
          await update((draft) => { draft.entries.push(entry) })
        } catch (error) {
          if (active) context.ui.toast.show({ message: `Could not save BTW history: ${String(error)}`, variant: "error" })
        }
        // An in-flight answer can still be saved after a plugin reload, but must not reopen its old UI.
        if (active) show(sessionID, entry)
      } catch (error) {
        if (active) context.ui.toast.show({ message: String(error), variant: "error" })
      } finally {
        setPending((count) => count - 1)
      }
    }

    function currentSession() {
      const route = context.ui.router.current()
      if (route.type === "session") return route.sessionID
      context.ui.toast.show({ message: "Open a session first", variant: "warning" })
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Show when={pending() > 0}><Pending context={context} /></Show>,
    })

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.aside",
              title: "BTW history",
              group: "Session",
              palette: true,
              slash: { name: "btw", arguments: true },
              async run(input) {
                const sessionID = currentSession()
                if (!sessionID) return
                const question = input?.trim()
                if (question) return ask(sessionID, question)
                const [saved] = history(sessionID)
                if (saved.entries.length === 0) return ask(sessionID)
                show(sessionID)
              },
            },
            {
              id: "btw-plus.ask",
              title: "Ask a side question",
              group: "Session",
              palette: true,
              async run() {
                const sessionID = currentSession()
                if (sessionID) await ask(sessionID)
              },
            },
          ],
        }))
        return null
      },
    })

    return async () => {
      active = false
      await clipboard?.dispose()
    }
  },
})
