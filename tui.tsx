import { Plugin } from "@opencode/plugin/tui"
import { createClipboard, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core"
import { createEffect, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { AnswerDialog, HistoryDialog } from "./src/dialog"
import { Answer } from "./src/answer"
import type { History, Interaction } from "./src/history"
import type { PickerState } from "./src/history-picker"
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
    const [answers, setAnswers] = createSignal<Record<string, Interaction | undefined>>({})
    const pickers = new Map<string, ReturnType<typeof createStore<PickerState>>>()
    let active = true
    let clipboard: ReturnType<typeof createClipboard> | undefined

    function history(sessionID: string) {
      return context.storage.store<History>(`session.${sessionID}`, { initial: { entries: [] } })
    }

    function setAnswer(sessionID: string, entry?: Interaction) {
      setAnswers((current) => ({ ...current, [sessionID]: entry }))
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

    function picker(sessionID: string) {
      let state = pickers.get(sessionID)
      if (!state) {
        state = createStore<PickerState>({ query: "", selected: "new" })
        pickers.set(sessionID, state)
      }
      return state
    }

    function showHistory(sessionID: string) {
      const [saved] = history(sessionID)
      const [state, setState] = picker(sessionID)
      context.ui.dialog.show(() => (
        <HistoryDialog
          context={context}
          entries={saved.entries}
          state={state}
          select={(id) => setState("selected", id)}
          search={(query) => setState("query", query)}
          open={(entry) => expand(sessionID, entry)}
          ask={() => { void ask(sessionID) }}
        />
      ))
    }

    function expand(sessionID: string, entry: Interaction) {
      context.ui.dialog.show(() => (
        <AnswerDialog
          context={context}
          entry={entry}
          history={() => showHistory(sessionID)}
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
        // Keep the result with its session without taking focus or replacing an open dialog.
        if (active) setAnswer(sessionID, entry)
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
      append: "session.composer.top",
      render: (slot) => (
        <box>
          <Show when={answers()[slot.sessionID]} keyed>
            {(entry) => {
              // Pending inputs include local submissions before the server acknowledges them.
              // Remember existing IDs so an earlier send cannot dismiss a newly arrived answer.
              const submitted = new Set<string>()
              for (const input of context.data.session.pending.list(slot.sessionID)) submitted.add(input.id)
              createEffect(() => {
                for (const input of context.data.session.pending.list(slot.sessionID)) {
                  if (input.type === "user" && !submitted.has(input.id)) {
                    setAnswer(slot.sessionID)
                    break
                  }
                }
              })
              return (
                <Answer
                  context={context}
                  entry={entry}
                  docked
                  copy={copy}
                  back={() => setAnswer(slot.sessionID)}
                  history={() => showHistory(slot.sessionID)}
                  ask={() => { void ask(slot.sessionID) }}
                  expand={() => expand(slot.sessionID, entry)}
                />
              )
            }}
          </Show>
        </box>
      ),
    })

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.aside",
              title: "Ask a question · leave blank for history",
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
                showHistory(sessionID)
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
