# EDL Checker — Research Studio, Day 06

A client-side delivery checker: point it at a folder of delivery packages
(EDLs + QuickTimes) and it reads every package in the browser, parses the EDLs
for their shots, and shows what was sent when — Packages / Shot search / Timeline.
Nothing is uploaded anywhere; the folder is read locally via the File System
Access API.

- **Single self-contained file:** `index.html` (no build, no server, copyable).
- Reskinned into the Research Studio editorial style; logic ported verbatim from
  the owner's standalone tool (`~/edl_checker/EDL_Checker_Standalone.html`).
- **Chrome / Edge only** — Safari and Firefox can't grant folder access. The page
  shows a clear notice on unsupported browsers.

## Status

- Lives at `lab.bukowiecki.co/edl-checker/`.
- **Published UNLISTED** — live, but NOT linked from the landing page yet
  (no Day 06 card). Add the card to `lab/index.html` + bump the counter when ready.
