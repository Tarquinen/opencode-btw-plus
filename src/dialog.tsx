import type { Context } from "@opencode/plugin/tui/context"
import { createEffect, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Answer } from "./answer"
import { HistoryPicker, type PickerState } from "./history-picker"
import type { Interaction } from "./history"

export function BtwDialog(props: {
  context: Context
  entries: readonly Interaction[]
  initialAnswer?: Interaction
  ask: () => void
  copy: (text: string) => Promise<void>
}) {
  const [answer, setAnswer] = createSignal(props.initialAnswer)
  const [picker, setPicker] = createStore<PickerState>({ query: "", selected: "new" })
  let browsing = !props.initialAnswer

  createEffect(() => {
    props.context.ui.dialog.set({ size: "large", centered: Boolean(answer()) })
  })

  function history() {
    browsing = true
    if (answer()) setPicker("selected", answer()!.id)
    setAnswer(undefined)
  }

  return (
    // Keep a stable renderable root: the host evaluates the dialog's render callback reactively.
    <box>
      <Show
        when={answer()}
        keyed
        fallback={
          <HistoryPicker
            context={props.context}
            entries={props.entries}
            state={picker}
            select={(id) => setPicker("selected", id)}
            search={(query) => setPicker("query", query)}
            open={(entry) => {
              browsing = true
              setAnswer(entry)
            }}
            ask={props.ask}
          />
        }
      >
        {(entry) => (
          <Answer
            context={props.context}
            entry={entry}
            copy={props.copy}
            back={() => browsing ? history() : props.context.ui.dialog.clear()}
            history={history}
            ask={props.ask}
          />
        )}
      </Show>
    </box>
  )
}
