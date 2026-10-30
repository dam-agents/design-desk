# Design Desk

Design Desk is a design partner for a product team. It watches what ships in your product's
screens and explains it to designers in plain words, then turns their ideas into variants,
live prototypes on the real product, and specs for developers. It replaces the Designer kit
and the DAM Prototyper and keeps everything they made: decks, mockups, walkthroughs, charts,
demo videos and copy.

| Who | Gets |
| --- | --- |
| Designers | Every UI change that ships, as a card with screenshots: what changed, why it is like this, what cannot change. Questions answered on the card. |
| Designers, PMs | A design request triaged first ("this is a design change" / "part needs a developer" / "this is a product decision"), then 2–3 variants to compare. |
| Developers, PMs | Votes and comments pinned to elements of a variant, before anyone builds. |
| The whole team | A **live prototype**: the real product with only its look changed, on its own instance with demo data. |
| Developers | A spec of the approved design: screens, states, copy, the exact change, and what is left for them. |

It never changes what a product does. A prototype may change layout, styles, copy and icons;
a guard reads every prototype's diff and refuses anything that touches data, rules,
permissions or behaviour, and people are told up front what can and cannot be done.

How it is built and why: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Get started

1. In DAM, open **Starter kits → Productivity → Design Desk** and create the agent. It needs a
   **GitHub** connection.
2. Turn on **Interactive artifacts** and **Environments** (Settings → tap the version five
   times → Experimental features).
3. Answer the onboarding questions: which repositories, which language, who uses the Desk.
4. Share the Desk page with your team: open it in the app → Share → Restricted → their emails.

Bind a **Slack** channel to ask questions and send requests from there too.

## The product profile

Everything specific to one product lives in that product's repository, under
`.design-desk/<name>/`: what counts as UI, which paths a design change may touch, where the
"why" is documented, how to run a live prototype. The product team keeps it current in the
same pull request that changes what it describes. A repository without a profile still gets
change cards, variants and specs; live prototypes need one. Contract: [`docs/profile.md`](docs/profile.md).

## Settings

Every setting lives in the agent's `work/CONFIG.md` and is changed by asking the agent in its
chat. The list, with defaults: [`CLAUDE.md`](CLAUDE.md) → **Runtime configuration**.

| Env var | Purpose |
| --- | --- |
| `GITHUB_REPO_WORK` | Optional private repository `work/` is backed up to; wins over `work_repo`. |

## Runtime requirements

- DAM with the Claude Code harness, about 60 GiB of disk, the *trusted* egress preset.
- The owner's **Interactive artifacts** feature (the Desk) and **Environments** feature (live
  prototypes).
- A **GitHub** connection, with read access to the watched repositories. Write access is used
  only when you turn it on: `prototype_remote` pushes prototype branches (named
  `design-desk/…`), `handoff: issue` files issues, `handoff: draft-pr` opens draft pull requests.
- A product's live prototype also needs what its profile's engine names: registries for its
  images (onboarding proposes the hosts to the owner).

## External surfaces

- **The Desk** — one interactive artifact, private until the owner shares it with named
  people; never public. Its data stays in the agent's machine and its backup.
- **Environments** — one per live prototype, opened by the people on the owner's list, each
  with an expiry. They run the product with demo accounts and demo data only.
- **GitHub** — reads only, unless `prototype_remote` or `handoff` say otherwise.
- **Slack** — replies in threads; announcements only with `notify: slack`.

## Runs

| Run | When | What |
| --- | --- | --- |
| Watch | hourly | merged PRs that touch the UI → Desk cards |
| Inbox | every 10 minutes, and at once when someone acts on the Desk | questions, requests, variants, prototypes, specs |
| Monitor | every 15 minutes | the agent's own health, from local files; silent when healthy |
| Audit | Fridays | a weekly self-check, reported in the chat |

Idle runs wake no model: each schedule's Precheck decides first.

## Contributing

The skills are in [`.agents/skills/`](.agents/skills/), the `design` CLI and the guard in
[`toolkit/`](toolkit/), the Desk server and page in [`desk/`](desk/). `bash scripts/tests/run.sh`
runs the offline tests (`node --test toolkit/tests desk/tests` for the node ones). Read
[`docs/self-modification.md`](docs/self-modification.md) before opening a PR.
To look at the Desk page locally: `DESK_PORT=5599 WORK_DIR=/tmp/dd node desk/server.mjs` and
`node desk/dev/harness.mjs 5600 5599`, then open `http://localhost:5600/?as=alice@example.com`.
