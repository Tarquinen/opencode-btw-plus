import { expect, test } from "bun:test"
import { InputRenderable } from "@opentui/core"
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
  expect(first.presentation()).toEqual({ size: "large", centered: true })
  first.mockInput.pressEscape()
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

test("history searches answer text, keeps newest first, and restores search and selection on Escape", async () => {
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
  f.mockInput.pressEscape()
  await f.flush()
  expect(f.captureCharFrame()).toContain("BTW history")
  expect((f.renderer.currentFocusedEditor as InputRenderable).value).toBe("wal")
  f.mockInput.pressEnter()
  await f.waitForFrame((frame) => frame.includes("SQLite uses WAL mode."))
  expect(f.captureCharFrame()).toContain("Older SQLite question")
  expect(f.captureCharFrame()).toContain("SQLite uses WAL mode.")
  expect(f.generate).not.toHaveBeenCalled()
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
  f.mockInput.pressEscape()
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
})
