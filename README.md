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

In an answer: **C** copies, **H** opens history, **N** asks another question, and **Esc** goes back or closes.
