# btw-plus

OpenCode's `/btw`, with searchable history saved per session.

## Install

Requires OpenCode V2 2.0.11+. Run `bun install`, then add these entries to `plugins` in `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    "-opencode.btw",
    "/absolute/path/to/btw-plus"
  ]
}
```

This replaces the built-in `/btw`.

## Usage

- **`/btw <question>`** — ask a side question, just like the built-in command.
- **`/btw`** — browse saved answers, or ask a question if history is empty.

Answers appear above the prompt without taking focus. The dock closes when you send your next message; the answer stays in history. Press **F6** (or click the answer) to use **C** copy, **H** history, **E** expand, and **X** close. **Esc** or **F6** returns to your draft. **Ctrl+N** asks another question while the answer or history is focused.
