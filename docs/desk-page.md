# The Desk page — how it behaves

What `desk/page.html` shows and how it behaves: read it when you change the page or the Desk
server, or when a person asks what something on the page means. A run that only works its
worklist does not need it; what a run does on the Desk is in [desk.md](desk.md).

## The page

- **A request's state.** The box under a request's title says where it stands and whose move it is.
  Its word is one of five stages, the same for every request: **Checking**, **Options**, **Feedback**
  (the team's votes; a live prototype to try), **Approved** (the spec), **With developers**; a closed
  request reads Closed or Decided without a design. A few words after it say where in the stage it
  stands (*done, no options yet*, *3 drawn*, *the vote ended*). Every stage ends with a person's move:
  a checked request stays in Checking until someone starts its options. The list's dot keeps its
  finer words (Checked, Options drawn; below).
  **Turn:** names who has the move, the same way in every state: Design Desk while it works or is
  about to; the team while it votes or tries a live prototype; developers once it is theirs; **you**
  when a way on is yours; else who can take it (*a designer*; once the vote ended, who approves).
  While Design Desk works, the box says what it does and how long: *started 4 min ago, usually about
  12 min* (the item's `started` and `usual_min`, the median of the last ten finished items of its
  kind, none before three), or before it started *starting* (the page called Design Desk) or *in the
  queue, starts within 10 minutes*. The state's mark pulses only while Design Desk works.
  On the right are **Approve**, **Close** and the request's **⋯**, in that order. One row holds the ways on after
  **Next:**: the first is the button, the others follow it after *or*. Checked: Draw design options.
  Options drawn: Ask for feedback. Feedback: Build a live prototype, End the vote. A live prototype
  that runs: Open the prototype; one that does not: Try again or Build it again, Redraw with all
  comments. A spec draft: Send to developers…. Sent: Show the design. Closed: Reopen. Contact a
  developer joins them wherever a part needs one, until it was opened. Approve is never in the row.
  With no way of the viewer's own, the row says what they wait for; with a question open, to answer
  it below: Design Desk's open questions stand right under the box, never inside it. **Design workspace** is not in the box: its button sits at the right end of the options' tabs, beside the design it opens. With a live prototype the options fold away, so the button stands at the row's right end instead, and the options' tabs leave it out when that fold opens: one button per view.
  **The design workspace** is laid out as a design tool. Its top bar holds the request, the options
  (number and name, one click each; a DD spinner while Design Desk works on one, faint while it waits
  in the queue; a count of its open comments), **+** for one more option, a pill naming the work and its
  option (`Working on a comment: “<its first words>” · <option>`; it breathes while the work waits in the queue), Figma in one menu, and Close. The bar under it holds only what is looked at: the
  design's pages (its own review bar is hidden in the workspace and driven from here), its states
  (‹ › before one menu by part, so the arrows never move), its alternatives and its version. The design sits on a canvas, glowing
  while Design Desk changes it; a strip above it names an alternative (**Use this one**), an older
  version (**Show the latest**) or the state's use. One tool bar under the design, icons only, each with its
  key in its one tooltip (name and key on top, what it does under them): **Click through** (P), **Select** (V), **Comment** (C), **Edit text** (T, whoever may change
  the design), then the comment pins (⇧C), the decisions (D), and the design's hotspots (H), notes
  (N), empty state (E) and dark theme (L) where it has them; the active tool is in the Desk's brown
  and sets the pointer. Esc steps back: a menu, the comment open, the selection, the workspace.
  It opens in Click through; an older version and the final check offer only Click through
  (**Make more changes** after a final check opens in Select).
  Each tool does one thing. **Comment:** a click on a part opens a comment beside it (**Comment**,
  posted for the team at once, and **Add to feedback**, kept on that spot until the feedback is
  sent, [desk.md](desk.md) → Reviews; nothing in the workspace asks Design Desk for a change at
  once), and opening it leaves the side panel as it is. Once a comment is posted (in place, or
  from the side panel), the part is let go and the panel turns to Comments with the new one in
  view, lit a moment; one added to the feedback turns it to **Your feedback**. **Edit text:** the text typed in
  place shows ✓ (Save, Enter) and ✕ (Cancel, Esc; a click elsewhere in the design cancels too).
  Save changes the words in the page at once, as the drawing's next version (`POST
  /api/cards/<id>/text`, `text_edit` on the drawing), with nothing for Design Desk to do but the
  decision check and, for an option with states, drawing them again. Text not whole between two
  tags, or on an alternative, opens that comment with the change written in instead. **Select:** the part shows in the side panel's
  **Properties**: why it is like this, **What should change?**, Every state, Try 3 ways, and Change
  the look. A comment's number on the design opens it in place (Reply, Add to my feedback, Mark done), as a
  click on it in **Comments**, the panel's other tab: every comment on the option by state, a box
  for one on the whole option or state, Open / Done / All and Add all to my feedback; and **Your feedback**,
  the third tab for who may comment (with its count): every note of theirs on the request waiting
  to be sent, across options, each with what it is about and ✕, a click showing its option, state
  and part, and **Send feedback…**, the page's dialog. A note in the feedback is no pin. Pins are in the Desk's brown,
  small and green once done, with a spinner while Design Desk works on them. The design fills the
  canvas a little in from its edges and the tool bar stands under it, so the canvas never scrolls. A part selected is let go
  by Click through, by another option, state or version, and once it no longer shows in the design
  (another page, a closed menu); a note's part the design has not opened yet stays selected.
  **Where a note is:** its part's path climbs to its view (`data-view`), an id or the page's root,
  and the part is looked for only inside the view the note was written on, found by its name and
  else by its number, so two views with the same markup never swap a note. A part that view no
  longer has opens the note on its own view, with no pin and **This place no longer exists in this
  version** above its words; another view is never opened for it.
  A part picked gets a name (`data-anchor`, [requests.md](requests.md) → Names notes hang on), the
  note on it keeps it, and the part is found by that name first. A note whose part a redraw left
  out (`anchor.gone`) pins only on the versions before; on that version and after it stays in
  Comments with **· not in this version**, and opens as one whose place is gone.
  **The look palette:** in Select, an admin, a designer or a UI dev owner gets **Change the look** in
  Properties, under the part selected: tabs Text, Fill, Spacing, Layout (a flex or grid
  part only) and Size, with steppers, segmented choices, colors, and a resize handle on the part's
  corner in the design. An element with smart controls opens on **Suggested** first: only the
  choices the product has for it, each named with its source ([requests.md](requests.md) → Smart
  controls); a variant drawn in full replaces the element in the preview. A change shows at once in the design only, a preview nothing saves. Steps
  follow the design's own text sizes, a spacing and a corner scale; colors offer the design's named
  colors (`--*` on `:root`) first, then those it uses, then any color, marked as not the design's.
  Other parts changed and not sent are listed under it, kept per drawing until the Desk is left;
  **Add to feedback** puts a part's edits in the person's feedback (**In your feedback**; listed
  under Your feedback as "Look of <part> · this browser", ✕ taking it out, the edit staying), and
  sending the feedback makes one note per part with `anchor.style` / `anchor.controls`, a `change`
  note with Request changes ([requests.md](requests.md) → revise). A reload drops them.
  The options' tabs are underline tabs with a number chip, in both modes and in the design
  workspace; what the chip's colour means is on the guidelines page ([The guidelines](#the-guidelines)). They stay one row and never scroll sideways: an option's tab shrinks to fit,
  its name cut with an ellipsis on the text's baseline (the page's `Desk Ellipsis` font; the full name on
  hover); what still does not fit folds, from the last tab, into **+n** at the row's end, a menu of the
  options it holds (the one shown always stays out), measured again as the pane changes width. **Design
  workspace** stays fixed at its right end. A redraw folds the row again for the tab shown.
  **Side by side:** an option's tab dragged onto the panel the tabs switch lights the half of
  that whole panel it would land on (left or right); the drop splits the design in two, that option in its half, the other half
  empty until another tab is dragged there. The empty half also offers **Show how it looks
  today**, the screen as it is in the product (`now`), or **Draw how it looks today**
  (`draw-now`) while there is none. Side by side is then the first tab, named for its halves
  (*⇆ 1 | Today*), showing the two designs alone; the option tabs switch as before, and its tab
  brings it back. Each half empties with its ✕; the tab's ✕ closes it. While its tab is shown
  the list folds away, and it comes back on another tab, unless the viewer folded or unfolded
  it meanwhile. Nothing of it is saved: it lasts while the request is open.
  What is about the request, not its step (Send to Slack… at Team feedback, the presentation, For
  Developers or For Designers, Redraw the options, New request from this, Delete), is under **⋯** at
  the right end of the box's top row, after Approve and Close. Send to Slack… is also in the design
  workspace's top bar, before Close; the options' bar holds only the votes and Open in Figma.
  The five stages are a row of their names along the box's bottom edge, joined by short lines:
  the passed ones in ink with a ✓, the current one bold and underlined in the state's colour, the
  ones to come grey. Each name's tooltip says what the stage holds (the verdict, who approved).
  An approved request reads Approved at once, while its status still waits for Design Desk to
  write the spec: no second Approve, no vote, and its questions are the spec's. Pointing at the state's
  word shows its help: what happens now and every way on from here as branches, each move the
  viewer can make, and each usual one they cannot, greyed, with why not and who can.
  Every dialog, the enlarged picture and the private ask close with a lone **✕** in the top-right
  corner and with Escape (desk/guidelines.html → Dialogs and forms). A form dialog with something
  typed, picked or added in it asks before ✕, Escape or a click outside closes it (its Cancel
  closes it at once); the element dialog, not a form, keeps a comment being written for its part
  instead ([The element dialog](#the-element-dialog)); a picture dropped on a dialog is added as if chosen.
  The browser's Back leaves the Desk: every view keeps the menu or its own way back on
  screen while it scrolls (the list beside an open item, or its back bar where the list hides
  on a narrow screen; the presentation's Exit, a picture's ✕).
  `desk/tests/page.test.mjs` drives every dialog in such a frame. It reports itself skipped
  only when it finds no Chromium or the toolkit's `playwright-core` is not installed.
- **Pages and filters.** A tab's pages are tabs at the top of its list: **For Designers**, **For
  Developers** and **For presentation** on Requests; **For Designers** and **For Developers** on
  PR Changes and Issues, each opened on the viewer's own as Requests ([desk.md](desk.md) → For
  Developers or For Designers); **Screens**, **Elements**, **Decisions**, **Kit** (an admin's, a designer's and a UI dev
  owner's: [Product → Kit](#product--kit)),
  **Differences** (with Figma on, [desk.md](desk.md#differences-from-figma)) and **History** ([Product → History](#product--history)) on Product. What narrows a page's list is one segmented filter under them (Designs: **To build** and **Done**; Changes: **Open** (not
  handled, the default), **Handled**, **Auto handled** (Design Desk found nothing to look at, `attention` `fyi`, or it shipped more than `change_auto_handled_days`, 14,
  ago and nobody marked it handled; it leaves Open and Needs a designer, and is never overdue), Needs a designer; Requests: **Your turn** (the default for anyone who may vote, **Open** for the rest: the next move is the viewer's own, by what they may do —
  answer Design Desk, start the options, ask the team, vote (until they voted, the list's
  `voted_mine`), approve (not while a vote runs in Slack), read and send the spec, build the
  prototype again; a draft of yours or, for the UI dev owner, a proposal; never while Design Desk works), **Unread** (not opened by you), **Open**, **Closed**;
  a draft or a proposal is on the viewer's own tab, whatever its side, and counts as Open; Issues:
  **All** (the default, designed issues too), then the buckets, then **Handled** (what a
  designer or a UI dev owner marked handled; it leaves the other lists); Decisions: In force, Not approved, Revoked, All),
  counts in a quiet pill. Both stay on top while the list scrolls; a filter wider than the list
  scrolls sideways and fades at its edge. A list has no search box of its own.
- **Counts in the menu.** Each tab counts only what is still open: Requests the open requests, PR
  Changes the changes not handled, Issues the issues neither handled nor designed.
- **Lists.** Every row on every list, the Presentation's included, is its title (one or two lines)
  with its number and its corner dot (a red **!** under the dot when it goes against a decision),
  bold until the person first opens it, and one line under it — where it came from, or a
  screen's or part's summary — and no chips. A value in that line with its word (`created:`,
  `from:`, `by:`, `decided:`, `in:` …) stays in ink and underlines on hover; a click filters the
  list to the rows with the same value, under a **Filtered by** bar whose **×** shows every row
  again (a link in the value still opens). The filter holds on that tab's page. A row with no state of its own
  keeps its number where the others have it. Every list on the left shows the newest item first: a change by the day it
  shipped, a decision by the day it was made, any other item by the day it came onto the Desk.
  The Presentation keeps the order a designer set. A list of items (every list but Decisions
  and the Presentation) shows its first 20 rows and 20 more each time its end scrolls into view;
  another tab, page or filter starts again at 20.
  The open item is always shown, and a **Filtered by** filter looks through every row.
- **Folds stay folded.** A folded box (the request, What's already known, an intro) stays folded
  when the page draws again, for example on another design tab. The page runs in a sandboxed
  frame where local storage can fail, so the page also keeps the choice in memory. A
  request's own text and What's already known show whole the first time a person opens the
  request in that browser, and folded on every later visit (`desk-seen-requests`). Folded, each
  keeps two whole lines of its text and half of the third; a heading above them shows whole and
  is not counted. Beside the folded request, What's already known keeps as much of its text as
  brings its Show link level with the request's, never less than two whole lines. A box with under three lines of text, no picture and nothing folded inside has
  nothing to hide: it shows whole, with no Show or Hide link. Folding and unfolding glide in a
  fifth of a second, so what stands under the box moves rather than jumps; folded from below,
  the page brings the box's top back into view.
- **A request in another language.** One with `translation` shows **EN** on the right of the
  request's head, a plain link: it shows the asker's words (and the title, unless a person
  renamed it) in English, and the language's code in its place brings the original back. The
  choice lasts while the page is open ([requests.md](requests.md) → A request in another language).
- **Search.** The header's one search finds words in every item's title, summary and source
  and in the decisions (`GET /api/decisions?q=`); an item's number (`R-12`, `r12`, `12`; [desk.md](desk.md#links-to-an-item)), a
  decision's (`D-3`), and while one is typed (`R-`, `R-1`, `D-`) every item or decision whose
  number starts so, newest first; a GitHub issue or pull request by its number (`#4512`, `PR 4512`) or link,
  matched to the card it is or came from; and a Desk link. Hits show as you type; Enter or a
  click opens one; ↑ ↓ pick, Escape closes. A GitHub number with no card offers its page on
  GitHub, in the profile's repository (`repos`); a Desk number with no item says so.
- **The menu.** **Requests** leads it (its count amber while one waits for an
  answer); **PR Changes** (the product's shipped changes, key `new`) and **Issues** follow, every
  tab alike, only the open one marked, every count grey, then **Product** and **People**; **+ New request** follows behind one more
  separator. The bell at the far right, after the person's name, opens
  [Notifications](#notifications). **How it works** opens from the question
  mark next to the day and night switch, with a picture each of how a request, an issue and a
  shipped pull request move. The switch keeps each person's choice on the Desk
  (`POST /api/prefs {theme}`, `theme` in `GET /api/me`; null follows the system), so it follows
  them to every device; the browser keeps a copy named for them only to open without a flash, marked unsaved until
  the server takes it, and sent again on the next load.
  **Simple mode**, a switch in the menu under the person's name (an on/off switch beside its
  words, in the accent when on), is review-first. The menu has one entry, **Requests & PRs**
  (current on Requests and PR Changes, its count the items in the reviews the viewer's default
  filter shows), and **+ New request**; its one list holds every request and pull request change,
  whatever its side — For Developers or For Designers only decides which review it is in — each in
  one state ([A request's state in the list](#a-requests-state-in-the-list)), the newest change
  first; only an archived change is not listed, nor someone else's draft, which the server sends only
  to its author and an admin. A row is the kind's icon (a change's in its pull request's ink, as the head's pill: green open, grey draft, purple merged; with a red dot on its upper right corner while an unread notification
  for the viewer is about the item, [Notifications](#notifications)), the title (two lines at most), when it last changed (Today, Yesterday or the
  day, with the time; the year only when it is not this year), then its number in the same grey
  words, never broken across lines (a change its pull request's, `PR#812`; a request, or a change
  with no pull request, its own on the Desk, `R-12` or `P-3`), who asked and where from in the same
  words (`by Pat Lee, from Slack`: the person behind a Slack message or an issue, never the Desk; a
  change's pull request author), the Desk's spinner while Design Desk works on it, and its state's
  pill on every row, in a column of its own on the right as high as the row, the rest narrowing for
  it (on a screen under 400 px, where a long date has no room beside it, on a line of its own under
  the date, at the right); a long name is cut with an ellipsis. A title is in English, here and in the head: Design Desk's translation, unless a person
  renamed it. The
  filter is one button at the list's right, its funnel icon alone (32 px, a dot on its border's corner while the
  filter hides anything — not every state and kind ticked, or Mine; its tooltip says what the list shows):
  its menu, opening inside the list, ticks any of State (**Draft** for anyone whose request
  starts as one, then **Dev review**, **Design review**, **In dev**, **Closed**) and Kind (**Requests**,
  **PR changes**), each with its count, at least one of each ticked, a state's row offering
  **Only** under the pointer (that state alone, the kinds and Whose kept), picks one of Whose
  (**Everyone**, **Mine**: what the viewer filed, wrote in (a private ask is not writing in it: no one else sees it), sent a review on or voted on, and the
  changes of the pull requests they authored, by the GitHub username People keeps, [desk.md](desk.md)
  → People; the list row's `mine`, which the server alone decides: a row without it is not the viewer's), each with its count, and offers **Reset to default** (Design review
  for a designer, every state for a PM, Draft and Dev review for a developer or a UI dev owner, every state before In dev
  for anyone else; both kinds; Everyone; a kept state they do not have is left out; the keys stay `proposal`
  for Dev review and `open` for Design review, so a kept filter keeps working); nothing shows beside the button. This browser
  keeps it (`desk-simFilter`). There is no Your turn, Unread or Needs a designer filter, and no
  For Designers / For Developers switch. An opened request or change starts with one head that
  stays in view while the page scrolls: the kind's icon, the title on one line (cut with an
  ellipsis, its full words on hover) with its number and the link icon close after it, the buttons
  beside it alone; under them, across the whole width, its state's pill a size larger than a row's, Design Desk's work in words beside the spinner, a change's pull request
  as a pill in GitHub's inks as tall as the state's, as full mode's dot (`#812 Draft` grey, `#812 Open` green, `#812 Merged`
  purple), a link to GitHub, a reported bug's **Bug** chip (with
  its severity), who asked and where from in the row's words, and when (a person by their name on
  the roster, else the name the item keeps, else the part of their address before the @), and once approved one muted
  line — who approved it and when, the issue or pull request it was sent to, when it shipped —
  then at most two buttons and ⋯: the stage's move on, if any, then **Submit feedback**
  ([Submit feedback](#submit-feedback)), which holds Request changes and every approval. Before design a
  request offers its stage's moves ([desk.md](desk.md) → Draft and Proposal), each only for who may: on a
  draft, to its author, **Send to design** (else **Propose**), with ⋯ holding **Propose** for a UI dev
  owner, and **Close…**; to a UI dev owner, on their draft or on a proposal, **Send to design**, with ⋯
  holding **Propose** or **Back to draft**, and **Close…**. Both ask first, as it cannot come back. Its
  **Approve for dev** is a verdict in Submit feedback, and asks as an approval does. No plain Approve;
  votes on a proposal in full mode (**Ask for feedback**, **End the vote**), none on a draft. While it
  is in Design review, a request's approval is **Approve** — which sends the spec as soon as it is
  written, with no box to tick, or, for one the Desk may not send by itself (a Slack origin, an open
  pull request; [handoff.md](handoff.md) → Review before it goes), leaves it in its review with **Send
  to developers** beside Submit feedback — and a change's **Approve** marks it handled; each only for
  who may. In Dev review after design opened, a request or a change has **Send to design** — the move
  to For Designers, for a UI dev owner or an admin, asking first; it then is in Design review — beside
  Submit feedback, whose approval is **Approve for dev** (on a change **Approve**, which marks it
  handled; on an approved request whose spec draft waits, **Send to developers** stands in Send to
  design's place). **Feedback** ([desk.md](desk.md) → Reviews): under the shown option, and in a change's or a part's
  dialog, a box offers **Add to feedback** — a draft, the viewer's alone — and **Comment**, a
  comment on the Desk at once (never on GitHub); the box at the end of the page posts at once. No box
  under the head lists the drafts: **Submit feedback** holds them. Sent feedback shows in Comments, in both modes, as
  one block: who, the verdict (**Changes requested** amber, **Approved** green, **Comments**), when,
  **On GitHub ↗** once posted, the note, then each of its comments with its replies. Full mode has
  the same **Changes requested** line under the title, the same boxes, the same **Changes** of a change and dialogs, and **Your feedback** at the top
  of Questions and comments while drafts wait, with the same **Submit feedback** in it; before design it
  offers no Approve. A request that went to design folds the conversations and feedback begun
  before it opened (`opened_at`) into **Before design · n**, after the rest, in both modes. ⋯ holds **Close…** or **Reopen** on a request
  — on one sent to developers, first **Mark as shipped** while it is In dev and **Not shipped yet** once
  it is Shipped, for whoever marks a design done (`built`: a developer, a UI dev owner, an admin;
  `POST /api/cards/R-<n>/built`): the store marks it built by itself when a merged change that builds it
  arrives ([Designs](#designs)), so this is the fallback when nothing links the two —, **Turn into a design request** on a
  change (and **Undo approval** on one approved), and **Open on GitHub** where there is a link. No vote buttons, rename or For Developers
  move (Send to design is the one move to For Designers). Under the head the page reads one way for both kinds: a short lead — a request's `gist`,
  Design Desk's few plain sentences on the problem and what will be done ([requests.md](requests.md)
  → Triage), a change's summary — then a request's **Original request** folded: where it came from
  and when (no name: the head has it), its words, and for one in another language `Written in
  <language>` beside a small **Show in English** button (**Show original** and `Translated from …
  by Design Desk` back); a request with no `gist` shows its words in full instead, open. Its words
  keep a readable width (680 px) however wide the screen; the designs and pictures take it all.
  Then the designs (a request's
  options, votes as counts only) or **Changes** (below), **What Design Desk
  found** (the decisions in force it goes against, a change's reasons to look at it, how it
  differs from the approved design, Figma when on, its check holding the pull request; else
  "Nothing to flag"), the long reads folded alike (**What's already known**, **Details**, a
  change's **Parts it changed** and **What changed and why**, and the impact's **Where else this shows up**, **Under the hood**, **Earlier
  decisions about it**), then **Comments**: each conversation a card, its first message with the
  replies indented under it, each by an avatar, the name, the role and a short date, a note on a
  design led by its option (and part) as a chip that opens the design workspace there; one marked
  done folds to one line (who wrote it and how it starts, who resolved it and when) that opens on
  a click. Reply, Mark done, Add to my feedback and Reopen work as in full mode. With nothing open, the pane shows
  instead of the Requests intro a box per state, **Draft** only while it holds
  something, then **Dev review**, **Design review**, **In dev** and **Closed**: how many items are
  in each — the viewer's alone while Whose is Mine, redrawn as the filter changes — (the reviews and In dev with their kinds, Closed with how many of them
  shipped in the last 7 days); a click on one filters the list to that state. Otherwise it hides: **Designs**, **Issues**, **Product** and **People** leave the menu — for
  every role but an admin, who keeps them all, for now, after **Requests & PRs**, with Product's pages, their
  intros' lines and their notifications as in full mode — (a sent
  request offers no **Show the design**), Product's pages their bar, the presentation leaves Requests (its page, its buttons on a card and in an intro), a
  request offers no **Build a live prototype** (a prototype already up still shows), and an
  option shows no **Why it looks like this** section (the design workspace keeps it
  in its side panel). An option's design (the mockup) and All elements start open, as in full mode. A
  row of a list a link opens (Product's, say) keeps its filters, and its source line leaves out `from:` (the system it came in through), and the rest
  (`created:`, `by:`, `based on:`) is only words: none of it filters, opens or links; a click
  on it opens the row.
  Nothing else names a role a request needs: no **Needs a designer** line or heading. A request offers no rename. Switching the mode
  starts an option's sections again as they first open. The tab
  intros and How it works, its drawings included, leave out what it hides, and so does the bell:
  no notification about an issue, a screen, an element or a decision, nor in its count.
  A link to anything hidden still opens it: a `D-3` in a request opens the decision, and
  `#people` or `#presentation` their pages. The Desk keeps each person's choice like day or
  night (`POST /api/prefs {simple}`, `simple` in `GET /api/me`; only the keys sent change), so
  it follows them to every device; with no choice (null) every role starts in simple mode. A choice the server has not taken yet stays in the browser,
  named for them (`desk-simple:<email>`, marked `desk-simple-unsaved:<email>`), and is sent
  again on the next load. The server's answer is what it saved; one with no `simple` keeps the
  choice just made, never the role's default. Turned on over a hidden tab (an open decision aside) or the
  presentation, the Desk goes to the requests.
  **Figma**, a switch under simple mode in the same style, shows only on a Desk with `figma:
  enabled`: off, that person sees no Differences page and no box of differences from Figma
  anywhere. Kept on the Desk like simple mode (`POST /api/prefs {figma}`, `figma_pref` in
  `GET /api/me`); with no choice (null) it is off.
  The Desk opens on Requests.
- **Changes**, on a pull request change's page in both modes: a tile per change on the canvas, drawn
  as an option's **All elements** — its after picture (else its before), its number, its name cut at
  two lines (in full on hover), a pill in the elements' words, **Changed** (a before and an after),
  **New** (a screen the change adds, `new`) or grey **No picture from before** (an after alone not
  known to be new), and where the viewer stands: *Not looked at*, *n notes*, *Changes asked* (a note
  sent on it while the developer owes the next version) or *✓ Looks good*, the tile's edge in the same colour. A
  change is a screen pair (`pair`, its pictures by `stage`) or a screen with no `stage`, in that order
  (`changesOf`, [desk.md](desk.md) → Reviews); one tile even for a single change. Beside **Changes**,
  its count, a bar and "n of m looked at", or "✓ All looked at". A screen Design Desk found looks the
  same as before (`unchanged`, [screens.md](screens.md) → What changed) is no change: no tile, not in
  the count, and one muted line under the tiles names it ("1 more screen the pull request shows looks
  the same as before: …"), a click opening it with no Looks good. A tile opens its change in the
  element's dialog ([The element dialog](#the-element-dialog)): its name and pill, **Submit feedback**,
  **‹ n of m ›** through the changes to look at (the unchanged ones among themselves), and ✕ in the
  head that stays while it scrolls; **Before** beside **After**, or **After** alone, each with its
  caption and where it came from; **Outline what changed** over them; the separate "What changed"
  picture is not shown. Under them, for who may comment on an open item: the viewer's notes on it
  waiting in their feedback, a box with the cursor in it, **Add to feedback** (primary) and **Looks
  good** (a mark with no words; then "You marked it as good" with **Undo**, and no Looks good while
  notes on it wait). No comment for the team there: what is written is for the developer. "n comments
  on this change ↓" closes the dialog on its conversations, and a conversation's **◎ <change>** chip
  opens it. Looks good opens the next change not looked at, and on the last opens Submit feedback's
  panel in the dialog, Approve picked where the viewer may and no note waits. **Request changes · n**
  counts notes, never marks. With no screens, a line says how they come: Design Desk's own copy of
  the product while one is free (`screens` on), else when the pull request merges; **Add screenshots**
  stays, and a box with **Add to feedback** alone takes notes on the whole pull request.
- **Motion.** Short, soft animations, in the `@media (prefers-reduced-motion: no-preference)`
  block of `desk/page.html`'s style, so a person whose system asks for less motion gets none:
  dialogs rise in and fade out with their backdrop, More and the menu under a name pop open,
  folds slide open and shut (a script eases the fold's height, so every browser slides; only a
  fold opened or shut by a click is kept, not one drawn open), the private ask grows from its button, a new message in it rises
  in, a newly opened item rises into the pane (a refresh of the same one does not), buttons and
  rows ease between states, and a toast comes and goes. Nothing waits on an animation; a
  browser without one of these features shows the change at once.
- **Tab intros.** Every tab but How it works and People has an intro, `INTRO` in `desk/page.html`
  (Designs too, for the roles that see it): it explains the process, never what is on the screen.
  Requests, PR Changes and Issues start with their flow and a colour key; every intro then lists
  its steps in order, in short plain words. Each step says who acts, and its number takes the
  colour of who acts (blue Design Desk, amber the team, violet live, green approved; grey for a
  step with none). Under **You can** it lists only the buttons the person signed in may press
  there — never one their role may not. A short tip ends it. It fills the pane beside the list
  while nothing is open there; People shows its roster and roles, which say the same. It folds;
  folding one folds every tab's, and the browser keeps the choice (`desk-intro` in its local
  storage). Its header row links **How Design Desk works**, beside Hide; a tab without an intro
  keeps the link above the pane. A change that adds, renames or removes a tab's action updates its intro too.
- **How it works** is built the same way: each process (a request, changing a design, a change
  that ships, planned work, and Designs for the roles that see it) with its steps from the same
  `INTRO`, and its flow and colour key where it has one; then what only a developer can do, your
  other agents over MCP (what they may do, whether it is on, and for an admin how to set it up,
  [mcp.md](mcp.md); full mode only), and how long things take.
- **Redraws keep your place.** The page polls; a menu that did not change is not redrawn, and a
  redrawn menu, list or private ask gives keyboard focus back to the same button. A private ask's
  answer shows as it lands, every 4 seconds while one is awaited, and the box keeps its text, focus and caret. A request's own work line
  (its Wait and what Design Desk does) leaves once an option was drawn after its item was filed; a request
  reopened and checked again, its item filed after its options, keeps the line.
- **Not reached.** A poll that gets no answer, or none within 15 seconds, shows "Can't reach
  Design Desk right now. Retrying…" with **Reload the page**, and polls every 4 seconds; coming
  back to the tab polls at once. An update restarts the server and republishes the
  page, and the page open before it may never get an answer again: after 20 seconds without
  one the page loads itself anew, unless a dialog is open or a text field holds text; then
  the banner offers **Reload the page**. A first load that gets no answer tries again by
  itself after 20 seconds.
- **Tooltips.** Every button, label (chip) and picture says on hover what it does, how it
  works or what it means: a button by `TIP` in `desk/page.html` (by its `data-` action), a
  label by its own `title`. A new button or label gets its line in the same change; a button
  that opens a dialog starts it with "[Opens a dialog]" (`DIALOG_ACTS`, `DIALOG_DATA`). The Desk
  shows them in its own box half a second after the pointer rests on one, and at once while another
  is up or just closed: the page turns each `title` into `data-tip`, so the browser's own
  tooltip never shows. In a list, a card's own button covers the card and shows neither a line
  nor a preview: a label (the sprint's, a state's) shows its line on the label alone, and an
  issue's or a pull request's preview shows on its link alone.
- **Buttons.** A button's icon comes from `BTN_ICON` in `desk/page.html`, by its `data-`
  action; one whose words start with a sign of their own (▶, ✓, 👍, +) keeps that sign.
  **More** closes on a click anywhere outside it, on Escape, and once something in it is picked.
- **One width.** An open item's text blocks (the request, what happens next, what is known,
  the threads) share the reading measure; only the designs run wider.
- **Done conversations fold.** A conversation marked done, on any item, folds to one line: its
  kind, who started it and their first words, then *done*; a click opens it with the option it is
  on, its jump to the part and Reopen. The order
  stays newest first.

## New request

**+ New request** opens one dialog. Full mode asks for the type (**Suggest a change**, **Report
something broken**), the words, how they picture it, the screen, how many design options (a slider,
0 to 5, 3 by default), questions first, the skills, a Figma link and up to two pictures. Simple mode
asks only for the words (an idea, a bug report or a suggestion alike: type `idea`), the pictures and
**Design options** as a row of buttons, **Just check** (0: Design Desk only checks what can be done,
said under the row) then 1 to 5, 1 by default; both modes call 0 **Just check**. A picture's ✕
takes it out. The words take the focus; Ctrl+Enter or ⌘+Enter sends.

The send button is larger, and split for whose request starts as a draft: its arrow offers
**Create draft** (private until sent on) and the one move the author may make at once, each with a
muted line — **Create proposal** for a developer, a UI dev owner or an admin (to the dev team),
**Send to design** for a PM (to the designers). The face keeps the last pick, in this browser
(`desk-request-start:<email>`). A designer's request opens at once: one **Send**. The pick is
`start` on `POST /api/requests` ([desk.md](desk.md) → Draft and Proposal).

## Submit feedback

One button holds a person's review of an item ([desk.md](desk.md) → Reviews): in simple mode's
head, in every dialog's head (a change's, a part's), and in full mode's **Your feedback**.

- **Its colour is the verdict it sends:** Approved's green for an approval (Approve, Approve for
  dev), also with nothing drafted yet; amber for **Request changes**; ink for **Comment only**. Inside
  it, its counts, each only when there is one: notes waiting (a pen) and changes marked Looks good (a
  check). The verdict is the one picked in its panel, else Request changes while notes wait, else the
  approval the viewer may send, else Comment only; it follows each note added or removed.
- **Who gets it:** whoever may send a verdict on the item (`verdictsFor`); someone who may only
  comment, once something of theirs waits to be sent.
- **Its panel** opens under it and never moves the page; one is open at a time, closed by Esc, a
  click outside it or **Keep drafting**, and kept through the page's redraws: on a change, how many
  of the changes to look at were looked at, a bar, and the ones not looked at as chips that open them
  (else "✓ All looked at"); each note and Looks good waiting (a Looks good on an unchanged screen is not counted), with what it is about (a change's opens
  it) and ✕; else a line saying where notes come from; the verdicts as one control, each with its
  line under it; a note for the whole feedback; and the send button in the verdict's colour (`Request
  changes · 2`, `Approve with 2 notes`, `Approve for dev`, `Send comments`).
- **The verdicts**, the viewer's own: **Request changes** (with options drawn on a request; on a
  change for who may handle it), the approval — **Approve** in Design review, **Approve for dev** in
  Dev review and, for the UI dev owner, before design — and **Comment only**. Look edits and comments
  to work in say they go only with Request changes; a change whose review goes to GitHub says so.
- **Sending:** an approval with nothing drafted and no note is the approval alone (a request's asks
  its questions; a change's marks it handled). Approving a request is the usual approval first, its
  own questions included, then the feedback; Approve for dev is the approval sent For Developers, the
  feedback going with it as an approval. Request changes or Comment only with nothing to send says
  to write a note first.

## The element dialog

A part under **All elements** opens in one dialog, the same in simple and full mode:

- **Before** beside **After**. After is the part as the option draws it. Before is the part as
  it is in the product: its picture taken from Design Desk's copy of the product, else cut from
  the request's *how it looks today*; the line under it says which ("The product at main
  (<commit>), with made-up data" or "Redrawn from the code by Design Desk", with when). A part
  with neither says **No picture from before**; a part the option adds shows one picture,
  **New**. Where both come from: [requests.md](requests.md) → The part before, from the product.
- **Take it from the product** (**Take it again** once there is one) under Before: for members,
  only while `screens` is enabled; Design Desk at work on it shows in its place.
- A part cut live from a page is laid out at a desktop width (1440 px, as the product's pictures
  are taken) and scaled into its box, so a narrow box never squeezes it; a part with no fill,
  border or shadow of its own is fitted by what it holds. A part on another view than the first
  opens that view first, once the design's review bar has made its view buttons. The tiles under
  All elements are drawn the same way; an enlarged part opens its view and is laid out wide too.
- **Its header stays** at the top while the dialog scrolls: the part's name and chips, **Open in
  design workspace**, **Submit feedback** ([Submit feedback](#submit-feedback): the feedback is sent
  from the dialog, which closes once it is), the way to the option's other elements and Close. It
  opens with the cursor in its comment box. **‹ n of m ›** steps
  through the option's elements in the order of its All elements tiles (a part it leaves out is
  skipped), round from the last to the first; each arrow names the element it opens. Another
  element opens as designed, at the top; what someone was writing on a part stays with it, and is
  back in its box when they come back to it, while the page is open: on stepping away, and on
  closing the dialog (✕, Esc).
- **Open in design workspace** (a very light violet fill, as on every way into it: the
  guidelines' Buttons) opens the option with the part selected, on its Properties, at the
  state shown in After. From the workspace, **Every state (n)** opens the dialog on the state the
  workspace shows, when it is one of the part's.
- **Comments**: the part's open comments (a click opens one in the design workspace), the
  viewer's notes on it waiting in their feedback ("Not sent yet", ✕), and a box: **Add to
  feedback** (the dialog's one primary button, as in the design workspace) keeps a note on the part
  ([desk.md](desk.md) → Reviews), **Comment** posts one for the team at once. Not on a closed request.
  Written while a state is shown in After, a comment or a note is about that state: the box says
  so ("Your comment is about <state>."), the note carries it, as one made in the workspace on that
  state does, and a listed comment shows the state's name before its author, a note waiting
  "Not sent yet · <state>".
- **Its states**, seen without leaving Before and After:
  - A **switcher** over After: ‹ and › round a pick, **As designed** first, then each state in the
    option's order, as the design workspace's State menu names and orders them. Only After
    changes; under it, the state's name and its one-line note, and "drawn for an earlier
    version" when it shows the option before its latest change. The step goes round.
  - **All states**, a fold under the pictures: As designed and each state; a click on one shows
    it in After, ringed in ink, so the fold and the switcher always agree. Simple mode shows a
    small tile of each; full mode each state's card with its number and the use case it covers.
    It starts folded; opened or folded, it stays so while the page is open.
  - Beside the switcher, for those who may draw: **Draw all states** while none is drawn,
    **Redraw states** while some are of an earlier version of the option, nothing once all are
    current; while Design Desk draws them, a chip says so. Never from the dialog the workspace
    opens to look through its states ([requests.md](requests.md) → Every state of a part).

## Product → Kit

The product's kit as `design kit` last read it ([requests.md](requests.md) → Smart controls),
shown only to an admin, a designer or a UI dev owner (`GET /api/kit` refuses anyone else). The list has one row per
kind of named value (Colors, Shadows, Corners, Spacing, Text sizes…) and one per component's
variants (`Button · variant`), each with its count and the files it comes from. A row opens its
tiles, drawn as the elements' are: a color's swatch, a shadow on a card, a corner, a spacing bar,
`Aa` at a text size. A variant is drawn as the product draws it, on the product's background: the
classes all variants share, the default of the component's other props, then its own, each
Tailwind class read through the kit's named values or its own literal (`text-[10px]`). A value the
kit does not name, or a class for another state, is left out, and the element gets no property no
class sets: a fallback style never passes for the product's. Beside it, *on hover*, when the
joined classes change under the pointer. Under it, its name, **default**,
what it sets in words (*Fill primary, height 40px*), its classes folded. Variants run the most
used first; a component whose look is not in classes says it has no picture. Above them: the
repository and commit it was read at, and when; one line on what Design Desk offers; the file it
is made in and how many files use it. A value the Desk cannot draw says *no preview*.
A file opens on GitHub at that commit. Under each tile, how many files use it (`uses`, every file,
though at most 30 are listed), the Elements drawn from one of them (a click opens the element),
then the files, folded; a value or variant no file uses says so. A kit read before `used_in`
existed shows no uses; one read before `uses` counts the files listed, *30+* at the cap.
Before the first `design desk kit` the list says *No kit yet*; a read that failed says the kit
could not be read, and why.

## Product → History

What happened to the product, put together on the page from what the Desk keeps: the changes
that shipped (by the day they merged), the decisions made, the requests filed. Under the page
tabs, one segmented filter, kept in the browser: **Days**, **Weeks** (the default) and
**Releases**. The list has one tile a period, the newest first, with its date and its counts, and no chips; a
week whose digest goes against a decision carries its red **!**.
Days and weeks are UTC; a week runs Monday to Sunday, so its tile is the weekly digest's week
([digest.md](digest.md)). **Releases** are the product's releases on GitHub as the watch run keeps
them ([watch.md](watch.md) → Releases): a change is in the first release that has its pull
request, a decision or a request in the first release published after it, and what came after
the newest one is under **Not released yet**, on top. A pre-release says so on its tile. With no
release kept, Releases says so and how they come.

A tile opens the period's page, drawn as an item's page: for a release, the status box a change
has (**Released** or **Pre-release**, its tag linking the release on GitHub, when it was published
and the release before it; **Not released yet** and since when); for a week, Design Desk's summary
with a link to the week's own page. Then the filters, each a segmented filter with its counts: All,
Changes, Decisions, Requests; and how the changes came about, **Any origin**, **As designed** (it
builds a design approved on the Desk), **Differs from the design** (its `design_check` differs),
**No design** and **Fix or polish** (the card's `fix`), only those it has; then where in the product
(the cards' `area`) and a search in the period's titles. The changes are grouped by where they are,
a group folds, and **Fold all** over them folds every group (**Open all** opens them again); then
the decisions, then the requests. Each row reads as a list's row — its title
(it opens the item), its number, one line of facts (shipped, from, origin) — and a change shows its
pictures right under it, before and after side by side as on its own page (the list's `shots`: its
first pair with both, else its first picture as the after). The texts stay on the change's page.
**← History** closes the period.

## A request's state in the list

In both modes, each request in the list shows its state as a dot in the row's top-right corner
(before design its stage: **Draft** grey, **Proposal** amber, with its moves in the state's row;
[desk.md](desk.md) → Draft and Proposal),
as large as the dot on the request's page and level with the title's first line, in the colour of
whom the request waits on — the same colour as the state on its page: **blue** Design Desk,
**amber** the team's votes or tries (Team feedback, Live — try it), **magenta** a person's move
(Checked: start the options; Options drawn: ask the team; No options, every option taken out at
Options drawn: draw them again; a question to answer; a prototype that
failed or was switched off; a spec draft to send); green sent to developers, slate decided, red
closed. It pulses only while Design Desk works on the request, whatever the step (then blue), and
stays lit otherwise. A request is never blue with a move of a person's own beside it: once
Design Desk's work is done, Checking reads **Checked** and Drawing options reads **Options drawn**. Team feedback
reads **Team feedback (finished)** once a person ended the vote, or its vote in Slack ended and no other runs. On the request's page a vote in Slack is a box under its header, not in an option's tab: while it runs, until when; once closed, each option by its number with its 👍, 👎 and ⚠️, read from the result Design Desk wrote (`Name: 7 👍, 2 👎. …`; a result in other words shows as written). Pointing at
the dot (not the row) unfolds it leftwards, over the title, into the label with its words.
A card that goes against a decision in force (the list's `against`) shows a red **!** under its
dot, in every list; pointing at it unfolds it the same way into `Goes against D-<n>`
(at most three numbers, then `+N`; the hint names them all). A change whose pull request Design
Desk's check holds (`ci: failing`, [watch.md](watch.md) → CI gate) has the same **!**, unfolding into
`Holds the PR`, until it is marked handled or merges. Product's
lists are drawn the same way: a screen's and an element's dot says whether its drawing is up to
date, out of date, being drawn or not drawn, and its line says `drawn: <when> from: Design
Desk by: live product` (an element: `by: source code`; or the person who added it; an element from an approved design is
`based on:` its request); a week's page says `by: weekly digest`; a decision's dot is In force,
Not approved or Revoked, with the red ! for a decision it goes against, and its line `decided: <when> from:
<where> by: <who>`.
Every item's page opens the same way: its title with its number grey after it (a request's ✎
rename after the number), a grey line of chips, then the same box as a request's status: the
state's dot and word, its buttons on the right. A change's and an issue's word is their GitHub
state (an issue's is where it is planned, `This sprint`), with a line of facts on the same line,
after its PR or issue as a pill that opens it on GitHub, in the list's style: `handled by:` who
`at:` when and `shipped:` when; an issue's `by:`, `assigned to:`. A screen's and an element's box
says what its dot says (Up to date, Out of date, Being drawn, Not drawn) and holds their buttons
(**Update the drawing**, **Draw how it looked before**, the presentation's); a decision's says In
force, Not approved or Revoked and holds **Approve** (when not approved), **Revoke…** or **Restore**. A week's page has no state: its chip says
Weekly digest. Needs a designer carries a
small AI tag: Design Desk judges what goes in it, the buttons (**Mark
handled**, **Adjust the design**; **Design this**) and ⋯ for the presentation. **Draw it** sits
under an issue's How it could look. A change and an issue show their GitHub state the same way, in the Desk's own inks (one green, one
violet, one grey on every page, the green the same as Approved): a change's pull
request **Draft** (grey), **Open** (green) or **Merged** (purple, `source.draft`, `source.merged_at`);
an issue **Open** (green) or **Designed** (purple, once its design went to developers). Whether a
person has seen an item is its bold title alone ([Read and unread](#read-and-unread)).
**In simple mode** an item has one state, by who works on it, whatever its side, and no status dot. **Draft**
(grey, dashed): a draft, its author's ([desk.md](desk.md) → Draft and Proposal). **Dev review**
(amber; its key `proposal`): the dev team decides — a proposal, and, For Developers, an open request
at any step before it is approved, one approved whose spec draft waits for a person to send it, and a
change nobody marked handled that is not auto handled; a UI dev owner approves it for developers or
sends it to design. Its pill says **Proposal** on a request not yet approved (a proposal, or an open
For Developers request), **Dev review** on a change and on a spec draft waiting, as Closed's pill says
how it ended. **Design review** (green; its key `open`): it needs a design decision — the same
three For Designers. Design Desk at work on an item leaves it in its review: the spinner says so. **In dev** (the accent): it is
approved and developers build it — a request writing its spec or sent to developers and not yet
built, a change handled or auto handled whose pull request is not merged, and a change a review asked
changes of until new commits arrive (its head says **Changes requested · developer**, and **Changes
requested · you** to its pull request's author, by the GitHub username People keeps, in both modes; a request a
review asked changes of stays in its review, its head saying **Changes requested · Design Desk**,
[desk.md](desk.md) → Reviews). **Closed**: nobody
works on it, and its pill says how it ended — **Shipped** (purple) a request built or a handled
change merged, **No review needed** (grey) an auto handled change merged, **Closed** (red) a
request closed, with a decision or without. An archived change is not listed, nor someone else's
draft (the server sends it only to its author and an admin, [desk.md](desk.md) → Draft and Proposal). Issues, screens, elements and decisions have no
simple state: simple mode lists none of them, and a link to one opens its full page.

A list row's title, in both modes, takes two lines at most and ends with an ellipsis; its tooltip
has it in full, and so does full mode's page (simple mode's head cuts it to one line, its words on
hover).

On a wide window the list folds away with an arrow halfway down its edge and comes back with
it; each browser remembers it (`desk-list-folded` in local storage). Dragging the edge makes
the list smoothly wider or narrower, at most 30 px either way from its usual width; the arrow
keys move the focused edge 10 px at a time, and a double click or Home puts it back. Each browser remembers it too (`desk-list-dx`). At a phone's width there is
no arrow and a folded list shows while no item is open; Guide and People have no list, and the
fold applies again on leaving them.

## Read and unread

An item's title in a list is bold until the person first opens it; from then on it is not, for
them alone (`POST /api/cards/<id>/read` from the page; the list's `read`; the store keeps
`reads: {<person>: {<card>: at}}`). Later opens and new activity change nothing. The **Unread**
filter keeps an item just opened, no longer bold, until the person changes the filter or the tab. You read
without marking anything.

## Notifications

The bell at the far right of the header, right of the person's name, lists what happened on the Desk in the
last 30 days, newest first, at most 50 (`GET /api/notifications`). Nothing new is logged: each
event is read from what the store keeps anyway. A person never sees their own doings, and a
private ask only its owner: Design Desk's answers to it are theirs alone, and for them. In simple
mode a row of the list whose item an unread notification For you is about has a red dot on its
icon's upper right corner, gone once the notification is read. The events:

| Event | When |
| --- | --- |
| New request, New PR change, New issue | an item is created (a request before design: when it opens) |
| New comment, New question, New reply | a message in a conversation |
| Design Desk answered, Design Desk asks | the agent answers a question, or asks one |
| New options drawn, Options redrawn | a run draws options, or new versions of them |
| New vote, Option approved, Spec ready, Closed with a decision | a request moves on |
| Feedback asked | a person hands the drawn options to the team (**Ask for feedback**); For you for every `developer` and `ui-dev-owner` |
| New decision, Decision revoked | a decision is added or revoked |
| Developer asks, Marked done | a developer asks a design's designer, or marks it done ([Designs](#designs)) |
| Feedback sent, New version | a person sends feedback (on a pull request's change, For you for every `developer` and `ui-dev-owner`); new commits arrive on a pull request a review asked changes of ([desk.md](desk.md) → Reviews) |

Every row is at most three lines, each cut short with … when long, and says the same things in the same places: an icon and what happened, who (when known),
how long ago, the item's kind in grey (Request:, PR change:, Decision: …), its title and number, and for a message or a vote one
line of what was said. Messages on one item in one day fold into one row, and so do votes: it
says how many (3 new messages) and who, two names and then +N, and shows the newest; a row is
For you, private or neither, never a mix, and the count counts rows.

A click lands on the source, not only its item, and every fold around it opens: a message with
its conversation unfolded and scrolled to it (a row of several lights each); a note from the
design workspace in the workspace, on its option, state and part, the note picked; a private answer in
the private chat, on the option it was asked about; options drawn, a vote or an approval on that
option's tab (its votes, or the request's state); a spec unfolded; a request on its text; a
decision on its page, a revoked one on why. The place pulses twice and fades out, 3 seconds
in all, and the glow keeps its place when the page draws again. A public notification closes the private chat, which would
cover it. The bell opens on **For you**: what the person
filed, voted on, approved or wrote in; **All** shows the rest too. In simple mode both leave out
an issue, a screen, an element and a decision, the pages it hides (Simple mode above). The red
count is the unread rows For you, in simple mode only what it shows (an admin's, who sees them all, the server's count, as in full mode). Opening the bell reads
nothing: a row is read, for that person alone, once they click it (`POST
/api/notifications/read?id=<row id>`; the store keeps `noted: {<person>: [ids]}`, only rows still
unread), and **Mark as read** in the bell's header, shown while a row is unread, reads every one
(`POST /api/notifications/seen`; the store keeps `seen: {<person>: at}`, the newest event's
time). Both are outside the write budget like reading an item, and a read row writes nothing. A
newer message on a folded row makes it a new, unread row. A click on a row that folded a newer message since the bell drew it reads the row its lead message or vote folded into, by the bell's own grouping (item, kind, day, For you, private, Designs), and a poll that left before the click never shows the clicked row unread again. Everything on an item that is the person's,
its messages included, is For you.

## Designs

A menu tab right after Requests, only for `developer`, `ui-dev-owner` and `admin`: the
requests sent to developers (`handed-off`), **To build** and **Done**, nothing else. Each send is an
item of its own with its own number, `G-<n>` (`design_id`, given when the request is handed off; a
send after a reopen gets a new one), shown on its row and its page. An item
shows, read-only: a status strip (**Approved**, or **Done**, with who approved it and when,
and who marked it done) holding the links to the issue or pull request it went to, the pull request it comes from
(a PR change it adjusts, or its origin) and the Figma frame, and **Mark as done** (`POST /api/cards/R-<n>/built`, `built: {by, at}`; **Not done yet**
takes it back, `not_built`). The store marks it done itself (`built: {by: {agent}, at, change}`) when a merged change card
that builds it is written: its pull request is the spec's or links its issue, or its `design_check` says `matches`;
never one a person took back. And **Open the request**, the same request on Requests; the
approved option as approved, **UX decisions** (`dev_summary`, the [handoff](handoff.md)'s step 7,
AI-marked; none, none shown), the issue's text (the sent spec) and **Ask the designer**: a
comment thread with `dev: true` (`threads` with `dev` from a role that sees Designs). One marked done folds to one line (its asker — its first words), under the open ones, as on every item. Its
messages are For you for the designer who approved the request, or every `designer` and
`admin` when a non-designer approved it, and land on its own number (`#G-<n>`): they open the page
without the menu. The request shows the same thread as *Developer asks*, and for a role that sees Designs its
state row holds **Show the design**, which opens it here. Answer nothing on it:
it is between people. Each closed record of a request reopened after it was sent (`sends`)
stays under **Done** as its own row (its own `G-<n>`, **· earlier send**; `#R-<n>~<k>` still opens it), read-only: **Closed**,
who reopened it and when, its issue, its summary and its questions, with no box to ask and no
Mark as done.

## The look

Every change to the page keeps to one scale; `desk/tests/page.test.mjs` fails on a value off it.

- **Text:** only the `--fs-*` tokens: `title` 26, `head` 17, `ui` 14, `meta` 12.5, `micro` 11.
  Weights 400, 500, 600; nothing bolder. One family: `--font`, `--mono` for code. Which size and
  weight a thing takes: the guidelines (Type).
- **Moving on:** every button that approves an item — Approve, Approve for dev, Send to developers,
  a change's Approve, Looks good — is Approved's green, outside a ⋯ menu.
  **Propose** and **Send to design** only send it on to the next review: outlined, with a paper plane.
  **Submit feedback** wears the colour of the verdict it sends ([Submit feedback](#submit-feedback)).
- **Corners:** two, `--r-sm` 6 and `--radius` 12, and two shapes, `999px` and `50%`; nothing
  else. Which a thing takes: the guidelines (Corners).
- **Space:** multiples of 4 (4, 8, 12, 16, 24, 32); 1 or 2px only as a hairline or a nudge. Which
  step goes where: the guidelines (Space).
- **Labels:** a label before its value (*Next:*, *Turn:*, *Created:*, *By:*) is grey; how a label
  is worded, its case included, is the guidelines' (Text). A role alone as a label is
  capitalised (*Designer*), inside a sentence as written. Design Desk's mark is the spark of its
  actions, never letters.
- **A request's box** keeps two rows above its stages: the state and Turn with Approve, Close and
  ⋯; then the ways on (sent: when and where on the left, the ways on at the right).
- **Buttons:** `.btn` 32px high, `.btn.small` 26px; which one is primary, and which green: the
  guidelines (Buttons).
- **Colours:** only the tokens on `:root`, each in light and dark; what a colour may mean, and the
  ink on a coloured fill: the guidelines (Colour). A step's number takes its box's colour in the
  flow above it. A fixed hex is only for what shows the product (a screenshot's white ground, a
  kit picture, the review bar inside a design).
- **Exempt from the scale:** glyphs (`::before`, `::after`, ✕ and ‹ › buttons), kit pictures, the
  flow's SVG labels, a stat's numeral and the presentation's slide.
- **One line:** the header holds one row down to about 1024px: under 1280px the name folds to its
  initial and the menu says who. A list's page tabs never wrap: they scroll, faded at the cut, and
  Product's **+ Add** is a **+** at their right end.
- **Ask privately** stays at the bottom right; every scrolling view leaves room under its end
  (`.detail`'s bottom padding) so it covers nothing at the end of a page. In simple mode it is
  its lock alone (with its count and spinner); its tooltip says what it asks about.

### The guidelines

`desk/guidelines.html` is the Desk's interface as a set of parts: what each is, when it is used
and what it means — tabs and switchers by meaning, buttons, state, colour, chips, folds, text,
comments, dialogs and forms, tiles, the toast, the tokens, in light and dark. Read it before a
change to the page, and build a new screen from its parts. It is for the people who design the
Desk and for this agent; it lives in the repository and is not published. Open it as a file.

- **Its examples are the Desk's components**, in the Desk's own stylesheet: `node
  desk/dev/guidelines.mjs` copies `desk/page.html`'s `<style>` into `desk/guidelines.css`, which
  the page links, so the page itself is its rules and reads whole. Its own style only lays the
  page out: each rule's subject is a `.gl-` class.
- **It cannot silently differ:** `desk/tests/guidelines.test.mjs` fails when the copy is stale,
  when the page carries the Desk's stylesheet itself, when it shows a class the Desk no longer
  styles, when its own style restyles a component, and when the Desk's option tabs are not the
  underline tabs it shows.
- **One home per rule.** What a part means and when it is used is the page's; the scale's numbers
  and how the code applies them stay under The look, which links to the page for the rest. A
  change to a part changes its rule there, in the same pull request.
