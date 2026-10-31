# Plug-ins

The core of Design Desk knows no channel, no tracker and no product.
What is specific to one of them lives in a **plug-in**: a skill with a kind, read when the
moment of its kind comes.
`design plugins [<owner/name>]` lists them as JSON (`name`, `kind`, `description`, `config`,
`source`, `path`); read the `path` before you do the work.

## Kinds

| Kind | Read when | Bundled |
| --- | --- | --- |
| `intake` | a report arrives on a channel ([requests.md](requests.md) → UI bugs) | [`intake-slack`](../plugins/intake-slack/SKILL.md) |
| `handoff` | an approved spec is delivered ([handoff.md](handoff.md) step 4) | [`handoff-github`](../plugins/handoff-github/SKILL.md) |
| `product` | any work on that product, after its `PROFILE.md` | none: they live in the product's repository |

One plug-in of a kind is used at a time: a product's own plug-in of a kind wins over the
bundled one.

## Where they live

- **Bundled**: `plugins/<name>/SKILL.md` in this definition.
- **A product's**: next to its design profile, `.design-desk/<profile>/<path>/SKILL.md`, listed
  in `profile.json` → `plugins` (paths relative to the profile).
  They are read from the default branch, like the profile, and carry what only that product
  needs: how to seed a prototype, how to draw a part of its UI, its own tracker.

## The contract

```markdown
---
name: handoff-jira
kind: handoff
config: [handoff, implementer]
description: >-
  One sentence: what it does and when.
---
```

- `name` and `kind` are required; `config` names the `work/CONFIG.md` keys it reads, so a new
  plug-in adds no key of its own without the CLAUDE.md list and the ONBOARDING example.
- A plug-in adds how, never what: it cannot loosen a hard invariant, the trust boundary or the
  design-only guard, and everything it reads from a channel or a tracker stays data.
- `design profile <owner/name> --check` checks that every plug-in the profile lists exists.
