# Species name in proposal ticket titles

## Intent

Ticket titles such as `[PlasmoDB] PXD084821 pknoA1H1` do not say which organism the
ticket is about unless the reader can decode the abbreviation. Every new ticket title
must name each organism's species in short form (`P. knowlesi`, `A. fumigatus`),
keeping the abbreviation, which is still useful.

## Goals

- New tickets from every propose skill are titled
  `[<projects>] <proposalId> <G. species> <abbrev>[, <G. species> <abbrev> ...]`,
  e.g. `[PlasmoDB] PXD084821 P. knowlesi pknoA1H1`.
- The species is found without the curator typing it.
- Publish refuses to create a ticket whose species it cannot find.

## Non-goals

- Existing tickets are not renamed, including when a republish reuses a recorded ticket.
- Pull request titles and load PR titles are unchanged.

## Design

- One shared function, `ticketTitle(manifest, speciesOf)` in
  `shared/scripts/lib/proposal-ops.js`, replaces the inline title at publish. It
  shortens a name to the genus initial and species epithet; bracketed genera
  ("[Candida] auris") lose their brackets (`C. auris`).
- Species source per organism:
  - `source: "new"` (genome proposals): the manifest's `species`.
  - `source: "loaded"`: `organismFullName` of the organism's entry in the project
    XML on `origin/master`, cut to genus and species.
  - `source: { proposal }`: that genome proposal's manifest `species` on `origin/master`
    (or the working tree when it is the same branch).
- A missing species is an error naming the organism and where it was looked for.
  It is raised only when a new ticket must be created.

## Approaches considered

All titles come from one line in `publishProposal`, so a single shared function
covers all five propose skills; no per-skill change is needed. Asking the curator
for the species was rejected because every source above already records it.
Renaming existing tickets (one-time script, or renaming on next touch) was
considered and dropped at the user's request.

## Left to the builder

- Exact helper names and where the project-XML lookup lives (reuse
  `project-organisms.js` parsing).
- `sharedFiles` and `.gitattributes` updates; `sync-shared.js --check` and
  `skill-closure.js` must pass.
- A line in the propose skills' docs describing the title rule.
- Branch `ticket-title-species` off `main`; PR reviewer `jbrestel`.
