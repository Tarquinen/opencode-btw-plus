# btw-plus

OpenCode's `/btw`, with searchable history saved per session and a more focused UI.

## Install

Requires OpenCode V2 2.0.11+. Add these entries to `plugins` in `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    "-opencode.btw",
    "opencode-btw-plus@latest"
  ]
}
```

This replaces the built-in `/btw`.

## Usage

- **`/btw <question>`** — ask a side question, just like the built-in command.
- **`/btw`** — browse saved answers, or ask a question if history is empty.
