---
description: Redline — apply / list / check my screen markups (uses the Redline MCP server)
argument-hint: "[list | check | <request id> | any task]   (empty = apply my latest markup)"
---
Use the **redline** MCP server (tools: `list_edit_requests`, `get_edit_request`, `update_edit_request_status`, `delete_edit_request`).
These are UI changes I marked up on my screen with numbered boxes, arrows and pins.

What I typed after /redline: `$ARGUMENTS`

Decide what to do from that:

- **Empty, "apply", "latest" or "fix"** → apply my latest open markup:
  1. `get_edit_request` with id "latest". Study the annotated screenshot, each mark's zoomed crop and its coordinates.
  2. For every mark that is not finished, find the matching UI element in this codebase (use the URL / window title, nearby visible text and the crop) and make the change.
  3. After each mark, call `update_edit_request_status` for that mark: `review` with a short note naming the file you changed, `partial` with what is left, or `wontfix` with the reason. Never set `done`: I confirm it in the Redline app.
  4. End with one line per mark: `#n → what you changed (file)`.
- **"all"** → do the same for every open request (`list_edit_requests`, then each one, oldest first).
- **"list" or "status"** → `list_edit_requests` with status "all" and show a short table: id, status, progress, title. Don't change anything.
- **"check" or "review"** → for requests waiting for my confirmation, summarize what the agent changed per mark so I can confirm. Don't change anything.
- **A request id** (looks like `20261111-131033-6df8`) → apply that request, as above.
- **Anything else** → treat it as extra instructions for applying my latest markup (for example "only mark 2", "use Tailwind", "don't touch the header").

If there is no open request, tell me to press ⌥⇧M (Alt+Shift+M) to mark up my screen first.
