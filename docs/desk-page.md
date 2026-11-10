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
  On the right are **Approve** and **Close**, nothing else. One row holds the ways on after
  **Next:**: the first is the button, the others follow it after *or*. Checked: Draw design options.
  Options drawn: Ask for feedback. Feedback: Build a live prototype, End the vote. A live prototype
  that runs: Open the prototype; one that does not: Try again or Build it again, Redraw with all
  comments. A spec draft: Send to developers…. Sent: Show the design. Closed: Reopen. Contact a
  developer joins them wherever a part needs one, until it was opened. Approve is never in the row.
  With no way of the viewer's own, the row says what they wait for; with a question open, to answer
  it below. **Open in the design workspace** sits at the row's right end, never among the ways on.
  What is about the request, not its step (the presentation, For Developers or For Designers, Redraw
  the options, New request from this, Delete), is under **⋯** by the title.
  The five stages are a thin line along the box's bottom edge: done, now, to come. Pointing at the
  box, or tabbing into it, raises the line into their names over what lies below, moving nothing;
  each name's tooltip says what the stage holds (the verdict, who approved). Pointing at the state's
  word shows its help: what happens now and every way on from here as branches, each move the
  viewer can make, and each usual one they cannot, greyed, with why not and who can.
  A dialog with something typed, picked or added in it asks before Escape or a click outside
  closes it (its Cancel closes it at once); a picture dropped on it is added as if chosen.
  The browser's Back leaves the Desk: every view keeps the menu or its own way back on
  screen while it scrolls (the list beside an open item, or its back bar where the list hides
  on a narrow screen; the presentation's Exit, a picture's Close).
  `desk/tests/page.test.mjs` drives every dialog in such a frame. It reports itself skipped
  only when it finds no Chromium or the toolkit's `playwright-core` is not installed.
- **Pages and filters.** A tab's pages are tabs at the top of its list: **For Designers**, **For
  Developers** and **For presentation** on Requests; **Screens**, **Elements**, **Decisions**,
  **Differences** (with Figma on, [desk.md](desk.md#differences-from-figma)) and **History** on Product. What narrows a page's list is one segmented filter under them (Designs: **To build** and **Done**; Changes: **Open** (not
  handled, the default), **Handled**, **Auto handled** (shipped more than `change_auto_handled_days`, 14,
  ago and nobody marked it handled; it leaves Open and Needs a designer, and is never overdue), Needs a designer; Requests: **Your turn** (the default for anyone who may vote, **Open** for the rest: the next move is the viewer's own, by what they may do —
  answer Design Desk, start the options, ask the team, vote (until they voted, the list's
  `voted_mine`), approve (not while a vote runs in Slack), read and send the spec, build the
  prototype again; never while Design Desk works), **Unread** (not opened by you), **Open**, **Closed**; Issues:
  **All** (the default, designed issues too), then the buckets, then **Handled** (what a
  designer marked handled; it leaves the other lists); Decisions: In force, Not approved, Revoked, All),
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
  again (a link in the value still opens). The filter holds on that tab's page. A row with no state of its own (a week of History)
  keeps its number where the others have it. Every list on the left shows the newest item first: a change by the day it
  shipped, a decision by the day it was made, any other item by the day it came onto the Desk.
  The Presentation keeps the order a designer set. A list of items (every list but Decisions
  and the Presentation) shows its first 20 rows and 20 more each time its end scrolls into view;
  another tab, page or filter starts again at 20.
  The open item is always shown, and a **Filtered by** filter looks through every row.
- **Folds stay folded.** A folded box (the request, From Design Desk, an intro) stays folded
  when the page draws again, for example on another design tab. The page runs in a sandboxed
  frame where local storage can fail, so the page also keeps the choice in memory. A
  request's own text and From Design Desk show whole the first time a person opens the
  request in that browser, and folded on every later visit (`desk-seen-requests`). Folded, each
  keeps two whole lines of its text and half of the third; a heading above them shows whole and
  is not counted. A box with under three lines of text, no picture and nothing folded inside has
  nothing to hide: it shows whole, with no Show or Hide link. Folding and unfolding glide in a
  fifth of a second, so what stands under the box moves rather than jumps; folded from below,
  the page brings the box's top back into view.
- **Search.** The header's one search finds words in every item's title, summary and source
  and in the decisions (`GET /api/decisions?q=`); an item's number (`C-12`, `12`), a
  decision's (`D-3`), and while one is typed (`C-`, `C-1`, `D-`) every item or decision whose
  number starts so, newest first; a GitHub issue or pull request by its number (`#4512`, `PR 4512`) or link,
  matched to the card it is or came from; and a Desk link. Hits show as you type; Enter or a
  click opens one; ↑ ↓ pick, Escape closes. A GitHub number with no card offers its page on
  GitHub, in the profile's repository (`repos`); a Desk number with no item says so.
- **The menu.** **Requests** leads it, larger, its count blue (amber while one waits for an
  answer); **PR Changes** (the product's shipped changes, key `new`) and **Issues** follow smaller
  with grey counts, then **Product** and **People**; **+ New request** follows behind one more
  separator. The bell at the far right, after the person's name, opens
  [Notifications](#notifications). **How it works** opens from the question
  mark next to the day and night switch, with a picture each of how a request, an issue and a
  shipped pull request move. The switch keeps each person's choice on the Desk
  (`POST /api/prefs {theme}`, `theme` in `GET /api/me`; null follows the system), so it follows
  them to every device; the browser keeps a copy named for them only to open without a flash, marked unsaved until
  the server takes it, and sent again on the next load.
  **Simple mode**, a switch in the menu under the person's name (an on/off switch beside its
  words, in the accent when on), only hides: **Designs**, **Issues**, **Product** and **People** leave the menu (a sent
  request offers no **Show the design**), Product's pages their bar, the presentation leaves Requests (its page, its buttons on a card and in an intro), a
  request offers no **Build a live prototype** (a prototype already up still shows), and an
  option shows no **Why it looks like this** strip under it (the design workspace keeps its
  button). An option's design (the mockup) and All elements start open, as in full mode. A
  list's filters stay as they are drawn and filter as in full mode, **Needs a designer** among them.
  A row's source line (`created:`, `from:`, `by:`, `based on:`) is only words: none of it filters,
  opens or links; a click on it opens the row.
  Nothing else names a role a request needs: no **Needs a designer** line or heading. A request offers no rename. Switching the mode
  starts an option's sections again as they first open. The tab
  intros and How it works, its drawings included, leave out what it hides, and so does the bell:
  no notification about an issue, a screen, an element or a decision, nor in its count.
  A link to anything hidden still opens it: a `D-3` in a request opens the decision, and
  `#people` or `#presentation` their pages. The Desk keeps each person's choice like day or
  night (`POST /api/prefs {simple}`, `simple` in `GET /api/me`; only the keys sent change), so
  it follows them to every device; with no choice (null) a viewer starts in simple mode and
  every other role in full mode. A choice the server has not taken yet stays in the browser,
  named for them (`desk-simple:<email>`, marked `desk-simple-unsaved:<email>`), and is sent
  again on the next load. Turned on over a hidden tab (an open decision aside) or the
  presentation, the Desk goes to the requests.
  **Figma**, a switch under simple mode in the same style, shows only on a Desk with `figma:
  enabled`: off, that person sees no Differences page and no box of differences from Figma
  anywhere. Kept on the Desk like simple mode (`POST /api/prefs {figma}`, `figma_pref` in
  `GET /api/me`); with no choice (null) it is off.
  The Desk opens on Requests.
- **Motion.** Short, soft animations, in the `@media (prefers-reduced-motion: no-preference)`
  block of `desk/page.html`'s style, so a person whose system asks for less motion gets none:
  dialogs rise in and fade out with their backdrop, More and the menu under a name pop open,
  a request's stage line rises into its names,
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
  storage). A change that adds, renames or removes a tab's action updates its intro too.
- **How it works** is built the same way: each process (a request, changing a design, a change
  that ships, planned work, and Designs for the roles that see it) with its steps from the same
  `INTRO`, and its flow and colour key where it has one; then what only a developer can do and
  how long things take.
- **Redraws keep your place.** The page polls; a menu that did not change is not redrawn, and a
  redrawn menu or list gives keyboard focus back to the same button. A request's own work line
  (its Wait and what Design Desk does) leaves once an option was drawn after its item was filed; a request
  reopened and checked again, its item filed after its options, keeps the line.
- **Not reached.** A poll that gets no answer shows "Can't reach Design Desk right now.
  Retrying…" and polls every 4 seconds. An update restarts the server and republishes the
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

## A request's state in the list

In both modes, each request in the list shows its state as a dot in the row's top-right corner,
as large as the dot on the request's page and level with the title's first line, in the colour of
whom the request waits on — the same colour as the state on its page: **blue** Design Desk,
**amber** the team's votes or tries (Team feedback, Live — try it), **magenta** a person's move
(Checked: start the options; Options drawn: ask the team; No options, every option taken out at
Options drawn: draw them again; a question to answer; a prototype that
failed or was switched off; a spec draft to send); green sent to developers, slate decided, red
closed. It pulses only while Design Desk works on the request, whatever the step (then blue), and
stays lit otherwise. A request is never blue with a move of a person's own beside it: once
Design Desk's work is done, Checking reads **Checked** and Drawing options reads **Options drawn**. Team feedback
reads **Team feedback (finished)** once a person ended the vote, or its vote in Slack ended and no other runs. Pointing at
the dot (not the row) unfolds it leftwards, over the title, into the label with its words.
A card that goes against a decision in force (the list's `against`) shows a red **!** under its
dot, in every list; pointing at it unfolds it the same way into `Goes against D-<n>`
(at most three numbers, then `+N`; the hint names them all). Product's
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
under an issue's How it could look. A change and an issue show their GitHub state the same way, in GitHub's colours: a change's pull
request **Draft** (grey), **Open** (green) or **Merged** (purple, `source.draft`, `source.merged_at`);
an issue **Open** (green) or **Designed** (purple, once its design went to developers). Whether a
person has seen an item is its bold title alone ([Read and unread](#read-and-unread)).
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
private ask only its owner: Design Desk's answers to it are theirs alone, and for them. The events:

| Event | When |
| --- | --- |
| New request, New PR change, New issue | an item is created |
| New comment, New question, New reply | a message in a conversation |
| Design Desk answered, Design Desk asks | the agent answers a question, or asks one |
| New options drawn, Options redrawn | a run draws options, or new versions of them |
| New vote, Option approved, Spec ready, Closed with a decision | a request moves on |
| Feedback asked | a person hands the drawn options to the team (**Ask for feedback**); For you for every `developer` and `lead-developer` |
| New decision, Decision revoked | a decision is added or revoked |
| Developer asks, Marked done | a developer asks a design's designer, or marks it done ([Designs](#designs)) |

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
count is the unread rows For you, in simple mode only what it shows. Opening the bell reads
nothing: a row is read, for that person alone, once they click it (`POST
/api/notifications/read?id=<row id>`; the store keeps `noted: {<person>: [ids]}`, only rows still
unread), and **Mark as read** in the bell's header, shown while a row is unread, reads every one
(`POST /api/notifications/seen`; the store keeps `seen: {<person>: at}`, the newest event's
time). Both are outside the write budget like reading an item, and a read row writes nothing. A
newer message on a folded row makes it a new, unread row. Everything on an item that is the person's,
its messages included, is For you.

## Designs

A menu tab right after Requests, only for `developer`, `lead-developer` and `admin`: the
requests sent to developers (`handed-off`), **To build** and **Done**, nothing else. An item
shows, read-only: a status strip (**Approved**, or **Done**, with who approved it and when,
and who marked it done) holding the links to the issue or pull request it went to, the pull request it comes from
(a PR change it adjusts, or its origin) and the Figma frame, and **Mark as done** (`POST /api/cards/C-<n>/built`, `built: {by, at}`; **Not done yet**
takes it back, `not_built`). The store marks it done itself (`built: {by: {agent}, at, change}`) when a merged change card
that builds it is written: its pull request is the spec's or links its issue, or its `design_check` says `matches`;
never one a person took back. And **Open the request**, the same request on Requests; the
approved option as approved, **UX decisions** (`dev_summary`, the [handoff](handoff.md)'s step 7,
AI-marked; none, none shown), the issue's text (the sent spec) and **Ask the designer**: a
comment thread with `dev: true` (`threads` with `dev` from a role that sees Designs). One marked done folds to one line (its asker — its first words), under the open ones. Its
messages are For you for the designer who approved the request, or every `designer` and
`admin` when a non-designer approved it, and land on `#designs/C-<n>`: they open the page
without the menu. The request shows the same thread as *Developer asks*, and for a role that sees Designs its
state row holds **Show the design**, which opens it here. Answer nothing on it:
it is between people. Each closed record of a request reopened after it was sent (`sends`)
stays under **Done** as its own row (`C-<n>~<k>`, **· earlier send**), read-only: **Closed**,
who reopened it and when, its issue, its summary and its questions, with no box to ask and no
Mark as done.
