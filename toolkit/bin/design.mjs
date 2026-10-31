#!/usr/bin/env node
// design — the Design Desk kit's one entry point. Every skill and procedure calls it;
// run with no arguments for usage. Prints machine-readable results on stdout,
// problems on stderr.
const [cmd, ...args] = process.argv.slice(2);
const USAGE = `usage: design <command> [args]

  doctor                               check the toolchain (browser, ffmpeg, fonts, npm)
  repo clone <owner/name> [ref]        fresh clone into scratch; prints {dir, commit}
  repo detect <owner/name> [ref]       clone + propose a design profile (not saved)
  repo save <profile.yaml>             save a confirmed profile to work/profiles/
  repo show <owner/name>               print the saved profile
  profile <owner/name> [--clone <dir>] the product's design profile: .design-desk/ in the repo's
                                       default branch, else the saved one; prints JSON
  profile <owner/name> --check | --check-dir <dir>   validate a design profile's shape
  skill [<action>] [--repo <owner/name>]  which skill does an action (docs/actions.md)
  where <file> --export <Component> --root <clone>   where else the data an element shows appears
  build <src.html> <out.html> [--style repo:<owner/name>|brand|carbon|wireframe] [--ref <ref>]
                                       compile a variant, mockup or walkthrough source
  shot <page.html|url> <outdir> [--width 1440] [--views] [--dark] [--click <selector>]...
                                       full-length screenshots (light, dark, each view)
  capture <base-url> <outdir> --routes <routes.json> [--login <profile.json>]
                                       screens of a running app, signed in as the profile's demo account
  pr-shots <owner/name> <pr> <outdir>  the images a pull request's body and comments carry
  states <file.tsx> [--export <Component>] [--root <clone>]
                                       a component's state dimensions (props, values, conditions, hooks)
  guard <worktree> --base <ref> [--profile <profile.json>]
                                       the design-only check of a prototype diff; JSON verdict
  desk <command>                       the Desk store (run \`design desk\` for its commands)
  deck-new <deck.html> [--style brand|carbon]
                                       start a deck from the template, in the style's colors and fonts
  deck-pdf <deck.html> <out.pdf>       print a deck to PDF, one page per slide
  deck-check <deck.html>               the deck skill's mechanical checks
  video <page.html[?shot=Name]> <out.mp4> [fps] [music]
                                       render a demo video to MP4
  stills <page.html> <shot|""> <t1,t2,...> <outdir>
                                       PNG stills of a video at given times
  video-new <dir> [--style brand|carbon]
                                       start a video in <dir>: template + vendor/ (React, Babel, fonts)
  brand extract <file>... [--name <n>] read logo/screenshot/pptx/pdf/css into a draft brand
  brand show                           print the saved brand
  brand save <brand.json>              save a confirmed brand to work/brand/
  icons <package> <Name>...            check icon names exist in a package
`;
const table = {
  doctor: "./doctor.mjs", repo: "./repo.mjs", profile: "./profile.mjs", build: "./build.mjs", shot: "./shot.mjs",
  capture: "./capture.mjs", "pr-shots": "./pr-shots.mjs", guard: "./guard.mjs", desk: "./desk.mjs", states: "./states.mjs",
  "deck-new": "./deck.mjs", "deck-pdf": "./deck.mjs", "deck-check": "./deck.mjs", video: "./video.mjs", stills: "./video.mjs",
  "video-new": "./video.mjs", brand: "./brand.mjs", icons: "../lib/icons.mjs", skill: "./skill.mjs", where: "./where.mjs",
};
if (!cmd || !table[cmd]) { process.stdout.write(USAGE); process.exit(cmd ? 2 : 0); }
const mod = await import(table[cmd]);
await mod.main(cmd, args);
