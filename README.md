# pi-prose

Make every model write the way you want, with consistent prose rules and
styles you can switch instantly without restarting [Pi](https://pi.dev).

Two layers:

1. **Named output styles** -- switchable live, mid-session, with `/style`.
   Includes Claude Code's built-in styles, a `matter-of-fact` style mined from
   real usage, and ASD-STE100 Simplified Technical English.
2. **Prose contract** -- an optional `contract.md` appended to the system
   prompt on *every* turn, regardless of the selected style. Cycle from Claude
   to GPT to GLM and the register stays put.

Unlike Claude Code's output styles (which require `/clear` or a new session),
style changes here apply on the next prompt: the system prompt is rebuilt every
turn via `before_agent_start`.

## Install

```bash
pi install npm:pi-prose
```

## Use

| Command | Effect |
|---|---|
| `/style` | Picker; shows the active style |
| `/style <name>` | Activate for this session |
| `/style <name> --save` | Also save as your user default |
| `/style <name> --project` | Also save as the project default |
| `/style off` | Back to `default` for this session |
| `/style off --save` | Clear the saved user default |
| `pi --style <name>` | Start with a style |

The footer shows the active style when it is not `default`. The session's
style choice persists in the session file and survives resume and fork.

**Precedence** for the active style: session choice > project default > user
default > `default`.

## Built-in styles

| Style | What it does |
|---|---|
| `default` | No-op; the model's normal behavior |
| `matter-of-fact` | BLUF ledes, length matched to the question, sentences over bullet-splatter, `--` never em dash, value before mechanism, caveats stated once, no sycophancy or closing recaps |
| `proactive` | Executes immediately, minimizes interruptions, prefers action over planning. Never overrides explicit safety rules from project instructions |
| `explanatory` | Adds short "Insight:" notes explaining implementation choices and codebase patterns |
| `learning` | Collaborative learn-by-doing; asks you to write small, strategic pieces of code via `TODO(human)` markers |
| `ste` | [ASD-STE100](https://asd-ste100.org) Simplified Technical English: active voice, short sentences, one instruction per sentence, one word per meaning |

`default`, `proactive`, `explanatory`, and `learning` mirror Claude Code's
built-in output styles. `matter-of-fact` was distilled from style feedback
across ~10k real coding-agent prompts.

## Custom styles

Drop a Markdown file in either location (filename becomes the style name
unless `name` is set in frontmatter):

- User: `~/.pi/agent/prose/<name>.md`
- Project: `.pi/prose/<name>.md` (loaded only after the project is trusted;
  wins over user styles with the same name)

```markdown
---
name: diagrams-first
description: Lead every explanation with a diagram
---
When explaining code, architecture, or data flow, start with a Mermaid
diagram, then explain in prose.
```

The body is appended to the system prompt while the style is active. Custom
styles can override built-ins by using the same name. `/style` re-reads the
directories on every invocation, so edits apply without `/reload`.

## Prose contract

Create `contract.md` in the same directories to append instructions on every
turn, independent of the selected style (project wins over user):

- User: `~/.pi/agent/prose/contract.md`
- Project: `.pi/prose/contract.md`

Use it for the rules you never want to relitigate per style or per model:
banned punctuation, lede discipline, formatting invariants. A good starting
point is the `matter-of-fact` style body -- copy it into `contract.md` and
keep `/style` free for task-shaped modes like `explanatory` or `ste`.

## Comparison

| | Claude Code output styles | pi-prose |
|---|---|---|
| Switch takes effect | After `/clear` / new session | Next prompt |
| Baseline layer | None | `contract.md`, always on |
| Scope | Replaces system prompt sections | Append-only |
| Custom styles | Markdown + frontmatter | Markdown + frontmatter |
| Saved defaults | `outputStyle` in settings | `--save` (user) / `--project` |

Related: [`pi-output-styles`](https://www.npmjs.com/package/pi-output-styles)
is another take on named styles for Pi/OMP. pi-prose differs in the always-on
contract layer and the Claude Code-parity style set.

## License

MIT
