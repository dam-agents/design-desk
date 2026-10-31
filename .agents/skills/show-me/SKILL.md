---
name: show-me
description: >-
  Answer "show me how it looks" with a real picture: take the screen in the state asked for
  on Design Desk's own copy of the product and answer with the picture, on the Desk, in chat
  or in Slack. Use for questions like "how does Home look with no agents?", "what does the
  agents list show when one is over budget?", "ukaž mi nastavení agenta v tmavém režimu".
---

# Show me

The `show` action ([docs/actions.md](../../../docs/actions.md)). It needs the screens
instance ([docs/screens.md](../../../docs/screens.md)); without one, answer in words and say
the picture needs `screens: enabled`.

1. **The state.** Restate in one line what will be on the picture: the screen, the data,
   light or dark, the size ("Home, a new account with no agents, dark, a phone").
   Unclear which screen → ask once with your best guess.
2. **Which build.** The shipped product → `main`; a change still in a pull request → its
   `pr<n>` instance when it has one. Bring it up to date ([screens.md](../../../docs/screens.md)).
3. **The recipe.** Steps from the sign-in to the state, through the product's own screens,
   with made-up data only: `design capture <url> <dir> --recipe <recipe.json> --login
   <profile.json>`, with `--width 390` for a phone. A stuck step: look at its `-stuck.jpg`,
   fix, retry once; still stuck → answer in words with what blocked it.
4. **Look** at the picture (Read it) before anyone else does.
5. **Answer** with it:
   - on the Desk: `design desk asset <file> --kind screen --card C-<n>`, then answer the
     question with the picture in the text: `![<what it shows>](asset:<A-n>)`;
   - in Slack: `reply` with the picture attached;
   - in chat: the picture inline, or an artifact when there are several.

   Always say where it comes from: "Design Desk's copy of the product at <ref> (<commit>),
   with made-up data."
