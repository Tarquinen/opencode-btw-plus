import { expect, test } from "bun:test"
import { InputRenderable, type Renderable, type TextRenderable } from "@opentui/core"
import { writeFileSync } from "node:fs"
import type { Interaction } from "../src/history"
import { mount, tempStorage } from "./fixture"

test("a generated answer survives closing and reopening the terminal, isolated by session", async () => {
  const directory = tempStorage()
  const first = await mount({ directory })
  await first.invoke("  Why SQLite?  ")
  expect(first.generate).toHaveBeenCalledTimes(1)
  expect(first.generate.mock.calls[0]![0]).toEqual({
    sessionID: "ses_one",
    prompt: expect.stringContaining("Do not call any tools and do not take any actions.\n\nWhy SQLite?"),
  })
  expect(first.saved().entries[0]).toMatchObject({ question: "Why SQLite?", answer: "A concise **answer**." })
  expect(first.dialog()).toBeUndefined()
  expect(first.renderer.currentFocusedEditor).toBe(first.prompt()!)
  await first.focusAnswer()
  first.mockInput.pressKey("x")
  await first.flush()
  expect(first.captureCharFrame()).not.toContain("Why SQLite?")
  await first.close()

  const second = await mount({ directory })
  await second.invoke()
  expect(second.generate).not.toHaveBeenCalled()
  expect(second.captureCharFrame()).toContain("BTW history")
  expect(second.captureCharFrame()).toContain("Why SQLite?")
  second.mockInput.pressKey("ARROW_DOWN")
  second.mockInput.pressEnter()
  await second.waitForFrame((frame) => frame.includes("A concise answer."))
  expect(second.captureCharFrame()).toContain("A concise answer.")
  second.context.ui.dialog.clear()
  second.setRoute({ type: "session", sessionID: "ses_two" })
  await second.invoke()
  expect(second.prompts).toEqual(["/btw"])
  expect(second.captureCharFrame()).not.toContain("Why SQLite?")
})

test("history opens expanded answers and preserves search and selection when returning", async () => {
  const directory = tempStorage()
  const now = Date.now()
  const entries: Interaction[] = [
    { id: "older", question: "Older SQLite question", answer: "SQLite uses WAL mode.", createdAt: now - 86_400_000 },
    { id: "unrelated", question: "Unrelated topic", answer: "Use a terminal.", createdAt: now - 1000 },
    { id: "newest", question: "Latest SQLite question", answer: "Enable WAL mode here.", createdAt: now },
  ]
  writeFileSync(`${directory}/session.ses_one.json`, JSON.stringify({ entries }))
  const f = await mount({ directory })
  await f.invoke()
  const initial = f.captureCharFrame()
  expect(initial).toContain("Today")
  expect(initial.indexOf("Latest SQLite question")).toBeLessThan(initial.indexOf("Older SQLite question"))
  await f.mockInput.typeText("wal")
  await f.flush()
  expect(f.captureCharFrame()).not.toContain("Unrelated topic")
  f.mockInput.pressKey("ARROW_DOWN")
  f.mockInput.pressEnter()
  await f.waitForFrame((frame) => frame.includes("SQLite uses WAL mode."))
  expect(f.captureCharFrame()).toContain("Older SQLite question")
  expect(f.captureCharFrame()).toContain("SQLite uses WAL mode.")
  expect(f.dialog()).toBeDefined()
  expect(f.presentation()).toEqual({ size: "large", centered: true })
  expect(f.renderer.root.findDescendantById("btw-answer-dock")).toBeUndefined()
  f.mockInput.pressKey("h")
  await f.flush()
  expect(f.captureCharFrame()).toContain("BTW history")
  expect((f.renderer.currentFocusedEditor as InputRenderable).value).toBe("wal")
  f.mockInput.pressEnter()
  await f.waitForFrame((frame) => frame.includes("SQLite uses WAL mode."))
  expect(f.captureCharFrame()).toContain("Older SQLite question")
  expect(f.captureCharFrame()).toContain("SQLite uses WAL mode.")
  expect(f.generate).not.toHaveBeenCalled()
  f.mockInput.pressEscape()
  await f.flush()
  expect(f.dialog()).toBeUndefined()
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
})

test("long history scrolls the selected item into view and remains usable in a small terminal", async () => {
  const directory = tempStorage()
  const entries: Interaction[] = []
  for (let index = 0; index < 40; index++) {
    entries.push({ id: `q${index}`, question: `Question ${index}`, answer: `Answer ${index}`, createdAt: Date.now() - index * 1000 })
  }
  writeFileSync(`${directory}/session.ses_one.json`, JSON.stringify({ entries }))
  const f = await mount({ directory })
  await f.invoke()
  f.mockInput.pressKey("END")
  await f.flush()
  expect(f.captureCharFrame()).toContain("Question 39")
  f.resize(46, 18)
  await f.flush()
  expect(f.captureCharFrame()).toContain("Question 39")
  f.mockInput.pressEnter()
  await f.waitForFrame((frame) => frame.includes("Answer 39"))
  expect(f.captureCharFrame()).toContain("Answer 39")
  expect(f.presentation()).toEqual({ size: "large", centered: true })
  f.mockInput.pressKey("h")
  await f.flush()
  expect(f.captureCharFrame()).toContain("Question 39")
})

test("bare /btw prompts only with empty history; whitespace and cancellation do not generate", async () => {
  const f = await mount({ prompt: "   " })
  await f.invoke()
  expect(f.prompts).toEqual(["/btw"])
  expect(f.generate).not.toHaveBeenCalled()
  f.setRoute({ type: "home" })
  await f.invoke("question")
  expect(f.toasts.at(-1)?.message).toBe("Open a session first")
  expect(f.generate).not.toHaveBeenCalled()
})

test("History and New question actions work even when the search has no matches", async () => {
  const f = await mount({ prompt: "Another question" })
  await f.invoke("Original question")
  await f.focusAnswer()
  f.mockInput.pressKey("h")
  await f.flush()
  expect(f.captureCharFrame()).toContain("BTW history")
  await f.mockInput.typeText("no matching phrase")
  await f.flush()
  expect(f.captureCharFrame()).toContain("No matching questions")
  expect(f.captureCharFrame()).toContain("+ Ask a new question")
  f.mockInput.pressKey("n", { ctrl: true })
  await f.waitForFrame((frame) => frame.includes("Another question"))
  expect(f.prompts).toEqual(["/btw"])
  expect(f.saved().entries).toHaveLength(2)
  expect(f.generate.mock.calls[1]![0].prompt).not.toContain("Original question")
})

test("generation errors clear pending status, and storage errors still leave the answer readable", async () => {
  const failed = await mount({ generate: async () => { throw new Error("Provider unavailable") } })
  await failed.invoke("question")
  expect(failed.toasts.at(-1)?.message).toContain("Provider unavailable")
  expect(failed.captureCharFrame()).not.toContain("/btw")
  await failed.close()

  const unsaved = await mount({ failWrite: true })
  await unsaved.invoke("Keep this answer readable")
  await unsaved.waitForFrame((frame) => frame.includes("A concise answer."))
  expect(unsaved.toasts.at(-1)?.message).toContain("Could not save BTW history")
  expect(unsaved.captureCharFrame()).toContain("A concise answer.")
})

test("concurrent answers save to their original session even when they finish out of order", async () => {
  const pending: Array<(answer: { text: string }) => void> = []
  const f = await mount({ generate: () => new Promise((resolve) => pending.push(resolve)) })
  const first = f.invoke("First question")
  const second = f.invoke("Second question")
  f.setRoute({ type: "session", sessionID: "ses_other" })
  pending[1]!({ text: "Second answer" })
  await second
  pending[0]!({ text: "First answer" })
  await first
  const saved = f.saved().entries
  expect(saved).toHaveLength(2)
  expect(saved.find((entry) => entry.question === "First question")?.answer).toBe("First answer")
  expect(saved.find((entry) => entry.question === "Second question")?.answer).toBe("Second answer")
  expect(f.generate.mock.calls[1]![0].prompt).not.toContain("First question")
  expect(f.captureCharFrame()).not.toContain("First answer")
  expect(f.captureCharFrame()).not.toContain("Second answer")
  f.setRoute({ type: "session", sessionID: "ses_one" })
  await f.waitForFrame((frame) => frame.includes("First answer"))
})

test("the dock preserves typing focus, expands on request, and scopes its shortcuts", async () => {
  const f = await mount({ prompt: "Next side question" })
  await f.mockInput.typeText("Draft: ")
  await f.invoke("A side question")
  await f.waitForFrame((frame) => frame.includes("A concise answer."))
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
  expect(f.captureCharFrame()).toContain("Main conversation")
  await f.mockInput.typeText("chxen")
  expect(f.prompt()!.value).toBe("Draft: chxen")
  expect(f.dialog()).toBeUndefined()
  expect(f.generate).toHaveBeenCalledTimes(1)

  const dock = f.renderer.root.findDescendantById("btw-answer-dock")!
  await f.mockMouse.click(dock.x, dock.y)
  await f.flush()
  expect(f.renderer.currentFocusedRenderable).toBe(dock)
  f.mockInput.pressKey("e")
  await f.waitForFrame((frame) => frame.includes("ctrl+n new question"))
  expect(f.presentation()).toEqual({ size: "large", centered: true })
  f.mockInput.pressEscape()
  await f.flush()
  expect(f.dialog()).toBeUndefined()
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
  expect(f.captureCharFrame()).toContain("A side question")

  await f.focusAnswer()
  f.mockInput.pressEscape()
  await f.flush()
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
  await f.focusAnswer()
  f.mockInput.pressKey("n", { ctrl: true })
  await f.waitForFrame((frame) => frame.includes("Next side question"))
  expect(f.saved().entries).toHaveLength(2)
  expect(f.prompt()!.value).toBe("Draft: chxen")
})

test("long answers stay compact, scroll, and leave space for the prompt on small terminals", async () => {
  let text = ""
  for (let index = 1; index <= 30; index++) text += `Paragraph ${index}.\n\n`
  const f = await mount({ generate: async () => ({ text }) })
  f.resize(46, 18)
  await f.invoke("A very long answer")
  await f.waitForFrame((frame) => frame.includes("Paragraph 1."))
  const dock = f.renderer.root.findDescendantById("btw-answer-dock")!
  expect(dock.height).toBeLessThanOrEqual(10)
  expect(f.captureCharFrame()).toContain("Main session prompt")
  expect(f.captureCharFrame()).toContain("↓ more")
  await f.focusAnswer()
  await f.flush()
  expect(f.captureCharFrame()).not.toContain("↓ more")
  f.mockInput.pressKey("END")
  await f.waitForFrame((frame) => frame.includes("Paragraph 30."))
  expect(f.captureCharFrame()).toContain("Main session prompt")
  f.mockInput.pressEscape()
  await f.flush()
  expect(f.captureCharFrame()).not.toContain("↓ more")
})

test("the overflow hint follows wrapping and mouse scrolling without taking prompt focus", async () => {
  const text = "This answer fits in the larger dock, but wrapping it in a narrow terminal hides the final sentence."
  const f = await mount({ generate: async () => ({ text }) })
  await f.invoke("Show a compact answer")
  await f.waitForFrame((frame) => frame.includes("This answer fits"))
  expect(f.captureCharFrame()).not.toContain("↓ more")

  f.resize(46, 18)
  await f.flush()
  expect(f.captureCharFrame()).toContain("↓ more")
  const body = f.renderer.root.findDescendantById("btw-answer-body") as Renderable
  const hint = f.renderer.root.findDescendantById("btw-answer-more") as Renderable
  expect(hint.y).toBe(body.y + body.height)

  await f.mockMouse.scroll(body.x + 2, body.y, "down")
  await f.flush()
  expect(f.captureCharFrame()).toContain("final sentence.")
  expect(f.captureCharFrame()).not.toContain("↓ more")
  await f.mockMouse.scroll(body.x + 2, body.y, "up")
  await f.flush()
  expect(f.captureCharFrame()).toContain("↓ more")
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)

  f.resize(88, 34)
  await f.flush()
  expect(f.captureCharFrame()).not.toContain("↓ more")
})

test("short answers shrink to their content and reflow when the terminal is resized", async () => {
  const f = await mount({ generate: async () => ({ text: "A short answer that fits on one line but wraps on a narrow terminal." }) })
  await f.invoke("Respond briefly")
  await f.waitForFrame((frame) => frame.includes("A short answer that fits on one line"))
  const dock = f.renderer.root.findDescendantById("btw-answer-dock")!
  expect(dock.height).toBeLessThanOrEqual(4)
  const height = dock.height
  f.resize(46, 18)
  await f.flush()
  expect(dock.height).toBeGreaterThan(height)
  expect(f.captureCharFrame()).toContain("Main session prompt")
  f.resize(88, 34)
  await f.flush()
  expect(dock.height).toBe(height)
})

test("the dock header keeps actions separate and truncates only the end of long questions", async () => {
  const f = await mount()
  const questions = [
    "Explain how the main conversation and side questions interact while keeping this entire beginning readable. ".repeat(3),
    "Explain 界面 👩‍💻 cafe\u0301 and side questions without splitting a character. ".repeat(3),
  ]
  function checkHeader(focused: boolean) {
    const header = f.renderer.root.findDescendantById("btw-answer-header") as Renderable
    const title = f.renderer.root.findDescendantById("btw-answer-title") as Renderable
    const text = f.renderer.root.findDescendantById("btw-answer-question") as TextRenderable
    const actions = f.renderer.root.findDescendantById("btw-answer-actions") as Renderable
    const frame = f.captureCharFrame()
    expect(text.plainText.endsWith("…")).toBe(true)
    expect(frame).toContain(text.plainText.trim())
    expect(text.x + text.width).toBeLessThanOrEqual(title.x + title.width)
    expect(title.x + title.width).toBeLessThanOrEqual(header.x + header.width)
    const buttons = actions.getChildren() as TextRenderable[]
    for (const button of buttons) {
      expect(frame).toContain(button.plainText)
      expect(button.height).toBe(1)
      expect(button.x).toBeGreaterThanOrEqual(header.x)
      expect(button.x + button.width).toBeLessThanOrEqual(header.x + header.width)
      if (button.y === title.y) expect(button.x).toBeGreaterThanOrEqual(title.x + title.width + 2)
      else expect(button.y).toBeGreaterThanOrEqual(title.y + title.height)
    }
    expect(frame).toContain(focused ? "h history" : "History")
    expect(frame).toContain(focused ? "x close" : "Close")
    return text.plainText.slice(0, -1)
  }
  for (const question of questions) {
    await f.invoke(question)
    for (const width of [100, 72, 64, 60, 46, 32, 100]) {
      f.resize(width, 34)
      await f.flush()
      expect((" · " + question).startsWith(checkHeader(false))).toBe(true)
      await f.focusAnswer()
      await f.flush()
      expect((" · " + question).startsWith(checkHeader(true))).toBe(true)
      f.mockInput.pressEscape()
      await f.flush()
    }
    // The dock can be narrower than the terminal when another pane is open.
    const dock = f.renderer.root.findDescendantById("btw-answer-dock") as Renderable
    dock.parent!.width = 40
    await f.flush()
    expect((" · " + question).startsWith(checkHeader(false))).toBe(true)
    dock.parent!.width = "100%"
    await f.flush()
  }
}, 15000)

test("dock buttons work directly without moving focus into the answer first", async () => {
  const f = await mount()
  await f.invoke("A clickable answer")
  await f.waitForFrame((frame) => frame.includes("A concise answer."))
  async function click(label: string) {
    const lines = f.captureCharFrame().split("\n")
    const y = lines.findIndex((line) => line.includes(label))
    await f.mockMouse.click(lines[y].indexOf(label), y)
    await f.flush()
  }
  await click("History")
  expect(f.captureCharFrame()).toContain("BTW history")
  f.context.ui.dialog.clear()
  await f.flush()
  await click("Expand")
  expect(f.presentation()).toEqual({ size: "large", centered: true })
  f.context.ui.dialog.clear()
  await f.flush()
  await click("Close")
  expect(f.captureCharFrame()).not.toContain("A clickable answer")
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
  expect(f.saved().entries).toHaveLength(1)
})

test("an arriving answer does not replace history or steal its search focus", async () => {
  const directory = tempStorage()
  writeFileSync(`${directory}/session.ses_one.json`, JSON.stringify({ entries: [
    { id: "saved", question: "Saved question", answer: "Saved answer.", createdAt: Date.now() },
  ] }))
  let finish: (answer: { text: string }) => void = () => {}
  const f = await mount({ directory, generate: () => new Promise((resolve) => { finish = resolve }) })
  const pending = f.invoke("Still working")
  await f.invoke()
  await f.mockInput.typeText("saved")
  const search = f.renderer.currentFocusedEditor as InputRenderable
  finish({ text: "Arrived in the background." })
  await pending
  expect(f.captureCharFrame()).toContain("BTW history")
  expect(f.renderer.currentFocusedEditor).toBe(search)
  expect(search.value).toBe("saved")
  expect(f.saved().entries).toHaveLength(2)
  f.context.ui.dialog.clear()
  await f.waitForFrame((frame) => frame.includes("Arrived in the background."))
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
})

test("only a new main-session submission dismisses the dock, leaving the answer in history", async () => {
  const f = await mount()
  await f.invoke("Keep this side answer")
  await f.waitForFrame((frame) => frame.includes("A concise answer."))
  const dock = () => f.renderer.root.findDescendantById("btw-answer-dock")

  f.mockInput.pressEnter()
  await f.flush()
  expect(dock()).toBeDefined()
  await f.mockInput.typeText("Continue the main conversation")
  await f.focusAnswer()
  f.mockInput.pressEscape()
  f.submitMessage("A different session", "ses_other")
  f.setPendingInputs("ses_one", [{
    id: "context", sessionID: "ses_one", type: "synthetic", payload: { text: "Editor context" },
    delivery: "steer", time: { created: Date.now() },
  }])
  await f.flush()
  expect(dock()).toBeDefined()
  expect(f.prompt()!.value).toBe("Continue the main conversation")

  f.mockInput.pressEnter()
  await f.flush()
  expect(dock()).toBeUndefined()
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)
  expect(f.saved().entries).toHaveLength(1)
  await f.invoke()
  expect(f.captureCharFrame()).toContain("Keep this side answer")
  f.mockInput.pressKey("ARROW_DOWN")
  f.mockInput.pressEnter()
  await f.waitForFrame((frame) => frame.includes("A concise answer."))
  expect(f.presentation()).toEqual({ size: "large", centered: true })
})

test("submitting while another BTW answer is pending dismisses only the answer already shown", async () => {
  const completions: Array<(answer: { text: string }) => void> = []
  const f = await mount({ generate: () => new Promise((resolve) => completions.push(resolve)) })
  const first = f.invoke("First side question")
  completions[0]!({ text: "The first answer." })
  await first
  await f.waitForFrame((frame) => frame.includes("The first answer."))

  const second = f.invoke("Second side question")
  const submission = f.submitMessage("Carry on", "ses_one")
  await f.flush()
  expect(f.renderer.root.findDescendantById("btw-answer-dock")).toBeUndefined()
  completions[1]!({ text: "The later answer." })
  await second
  await f.waitForFrame((frame) => frame.includes("The later answer."))

  // A delayed server echo updates the same input, then delivery removes it.
  f.setPendingInputs("ses_one", [{ ...submission, time: { created: Date.now() + 1 } }])
  await f.flush()
  expect(f.captureCharFrame()).toContain("The later answer.")
  f.setPendingInputs("ses_one", [])
  await f.flush()
  expect(f.captureCharFrame()).toContain("The later answer.")
  expect(f.renderer.currentFocusedEditor).toBe(f.prompt()!)

  f.submitMessage("Next main message", "ses_one")
  await f.flush()
  expect(f.renderer.root.findDescendantById("btw-answer-dock")).toBeUndefined()
  expect(f.saved().entries).toHaveLength(2)
})
