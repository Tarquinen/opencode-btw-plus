import { Answer } from "./answer"
import { HistoryPicker } from "./history-picker"

export function HistoryDialog(props: Parameters<typeof HistoryPicker>[0]) {
  props.context.ui.dialog.set({ size: "large", centered: false })
  return <box><HistoryPicker {...props} /></box>
}

export function AnswerDialog(props: Omit<Parameters<typeof Answer>[0], "back" | "docked" | "expand">) {
  props.context.ui.dialog.set({ size: "large", centered: true })
  return <box><Answer {...props} back={() => props.context.ui.dialog.clear()} /></box>
}
