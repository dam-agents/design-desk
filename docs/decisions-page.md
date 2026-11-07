# The decisions page — the team's design rules for coding agents

One public text page holds every decision on the Desk ([desk.md](desk.md) → Decisions), so a
coding agent that works on an issue without a design brief still follows how the product
must look. Only with `decisions_page: dam` (default `off`; `public`, the first spelling, still reads as `dam`).

## What is on it

`preflight.sh issues` renders it once a day into `work/decisions-page.md`, deterministically
from the Desk store: the decisions in force (text, why, concepts, when, who decided as a
**role**, where as a **kind**, what it replaces, Not approved yet), an index by concept, and
the revoked ones in one line each. It holds no names, logins, e-mails, links, keys or pictures.
The renderer redacts every free text (a decision's text, why, concepts, a revoke's reason):
every link (`https://…`, `www.…`, `host/path` for a dotted name, `localhost` or an IP, `user@host:path`, a Slack `<…|…>` link), every Slack `<@…>`,
`<#…>` or `<!…>` form, an e-mail in any case or script, an `@handle` (not `react@18`), a whole armored key block (PEM,
PGP, SSH2) and every known key or token shape, and every name the roster (its `name` column and
addresses) and the Desk store (a person's name, login and address wherever a record keeps one:
an author, a reporter, an assignee, a voter's address, a GitHub login) hold, whole and in parts of 3 or more
characters — a shorter name or part, such as `Jo`, stays. It fails closed: when the store or
the names cannot be read, or the finished page still holds a link, an address, a mention or a
key, the page is not due, the log names the decision and the field, and the audit warns; the
page published before stays public until the text is fixed on the Desk. Never edit the file:
a change to the page is a change to the renderer.

## `decisions_page_due` (the issues run)

The entry: `file`, `sha`, `artifact` (the id once published, else `null`), `counts`.

1. First time (`artifact: null`): `create_artifact {title: "Design decisions: <display_name>",
   content: <file>, file_name: "design-decisions.md", type: "code", visibility: "public"}`.
   Later: `update_artifact {id: <artifact>, content: <file>}`, so the link never changes.
2. Write `work/decisions-page.json` `{id, url: "<shareUrl>/raw", sha: <entry's sha>, at: <now, UTC>}`.
   Only after the publish succeeded: a failed one stays due and is tried again next day.
3. The first publish: tell the operator the `url` in the chat UI, to put into the coding
   agents' instructions (the product's `AGENTS.md`, the implementer's prompt).

`decisions_page: off` after it was published: leave the artifact; the audit reports it and
the operator deletes it.

## Elsewhere

- The agent manifest lists the page and its `design-decisions` contract ([manifest.md](manifest.md) → Sources).
- The audit warns when the page is due for more than two days ([audit.md](audit.md)).
