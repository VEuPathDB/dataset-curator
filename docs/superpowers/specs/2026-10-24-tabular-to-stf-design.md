# Tabular data to STF: design

Date: 2026-10-24
Status: approved 2026-10-24

## Intent

Curators receive multi-entity relational study data as plain tables
(clinical epidemiology: Village → Household → Participant → Sample/Assay;
mosquito surveillance: Collection site → Collection → Sample → Assay) and
need it in study-wrangler's Study Transfer Format (STF) so it can be
validated and loaded into VEuPathDB EDA.

A new skill, `tabular-to-stf`, does that conversion with an LLM doing the
judgement (entity tree, variable metadata, category tree, cleaning) and
zero-dependency scripts doing everything that must be exactly right
(ID integrity, structural checks, writing files).

It is also a prototype and learning exercise for a future web-based,
AI-assisted multi-entity user-dataset upload on VEuPathDB sites (e.g.
population surveillance data on VectorBase). Choices should keep that
future in view: an up-front study description as an input, explicit and
replayable data changes, and an STF spec that a machine can follow.

## Three modes

1. **Wrangler-free.** No R, no containers. LLM reasoning, ad hoc file
   munging and zero-dependency Node scripts produce hopefully-compliant STF,
   in the spirit of `sample-annotations-to-stf`. Typical user: a curator
   without docker.
2. **Mode 1 plus container validation.** As mode 1, then validate with
   study-wrangler in a container (`veupathdb/study-wrangler:1.0.52` from
   Docker Hub, via docker or podman) and correct the STF using the
   validator's feedback. Can also be entered directly on an existing STF
   directory (typical user: the data loading team checking a curator's mode
   1 output).
3. **Full study-wrangler (out of scope now; plan for it).** A separate,
   parallel route from raw data to STF, not a step after modes 1 and 2:
   the LLM writes an R "wrangler script" that reads the inputs, cleans them
   (user-approved changes become script steps), builds a Study object in
   memory and exports STF. Intended as the starting point for new datasets
   by expert curators. Developing it will likely mean improving
   study-wrangler methods and self-documentation.

## Goals

- Turn a folder of one-file-per-entity CSV/TSV tables into a full STF
  directory (`study.yaml`, `entity-<name>.tsv` + `entity-<name>.yaml`,
  `curation-notes.md`).
- Infer the entity tree; ask the user before any wild guess.
- Fill variable metadata (display name, data type and shape, unit,
  definition, ordinal levels, categorical value order) from the data, an
  optional free-text study description, an optional data dictionary in no
  fixed format, and batched questions to the user.
- Draft a variable category tree per entity for the user to approve.
- Clean predictably: auto-normalise trivia, flag likely typos, and get user
  approval for anything that changes data values.
- Record every change and decision in `curation-notes.md`, written so that
  each data change could be replayed as a script step.
- Mode 2: validate in the pinned container and fix until clean, or until
  only issues needing the user remain.

## Non-goals (now)

- Mode 3 implementation (but leave an obvious slot for it; see below).
- Denormalised, ISA-TAB/MAGE-TAB-style inputs where several entities share
  one wide file with parent values repeated in the left-hand columns, and
  IDs must be generated. On the long-term plan; nothing in this design
  should assume one file per entity beyond the intake step.
- File management and hand-off between curator and data loading team. A
  future project-management skill will wrap this one.
- STF collections (study-wrangler supports them; not needed yet).
- Messy input beyond the stated assumptions: inputs are UTF-8 CSV/TSV, one
  header row, no missing cells. (Missing-value handling still needs to be
  correct on output; see the STF docs.)

## Anti-goals (would make it a failure even if it "works")

- **Parent-child ID relationships wrong.** Duplicate IDs, orphaned child
  rows, or ID columns that disagree with the YAML `id_columns`. Childless
  parents are fine.
- **Broken variable tree.** A `parent_category` pointing nowhere, cycles,
  variables listed twice.
- **Output that doesn't load** with `study_from_stf(dir, validate = FALSE)`.
  A few validation errors are acceptable from mode 1; failure to load is
  not.
- **Silent data changes.** Any change to a data value that isn't logged, or
  a non-trivial one that the user didn't approve.
- **Editing the input files.** Inputs are read-only; all changes live in the
  output so it can always be diffed against the source.

## Constraints

- Lives in this repo as `skills/tabular-to-stf/`, following
  `docs/development.md`: `SKILL.md` + `resources/` (progressive disclosure)
  + `scripts/` (pure JavaScript, Node stdlib only, no npm dependencies,
  executable with shebang). Shared code goes through `shared/` and
  `package.json` `sharedFiles`; tests in `tests/` with `node --test`.
- Unlike the propose/verify skills, this skill does not need a
  VEuPathDatasets checkout and does no git operations; it does not use
  `check-workspace.js`.
- Study-wrangler pinned to **1.0.52** for mode 2 to start with. The pin
  lives in one constant, and **moves to the release that carries the
  expanded STF docs (1.0.53 or later)** once Deliverable A is released, so
  the bundled docs and the validator always come from the same version.
- **Target is EDA loading.** Validation always uses study-wrangler's `eda`
  profile (`validate(x, profile = "eda")` or equivalent), not just
  `baseline`. ("eda" does not go in the skill name.)
- **Size:** inputs up to ~100k–1M records per entity, processed in memory
  (as study-wrangler does). Streaming is out of scope. What the *model*
  reads is always a capped summary, never whole files.
- **Sensitive data:** users are in-house curators who know the issues. If
  the LLM notices likely PII (names, phone numbers, precise home
  coordinates, free-text notes), it says so once, gently, and records it in
  `curation-notes.md` under "Flagged, not changed". No enforcement or
  column exclusion. (The future web feature will need stronger steering;
  out of scope here.)
- Docker or podman required for mode 2 only.

## Deliverable A (first): STF documentation in study-wrangler

The STF docs in study-wrangler (`STF_documentation/`) become the single,
definitive source of truth for the format. Today `metadata-fields.md`
covers only `display_name`, `data_type`, `data_shape` and `provider_label`;
the package reads much more. Expand it (a study-wrangler PR) to cover every
field `entity_from_stf()` / `study_from_stf()` actually read, taken from
`R/Entity-metadata-defaults.R`, `R/entity_from_stf.R` and
`R/study_from_stf.R`, including at least:

- variable fields: `definition`, `unit`, `ordinal_levels`,
  `vocabulary_order`, `is_multi_valued` + `multi_value_delimiter`,
  `display_order`, `hidden`, `stable_id`, `parent_category`, and any others
  in the defaults table, each with allowed values and when to use it;
- the `categories:` section (keyed `category:`, with `display_name`,
  `definition`, `parent_category`; nesting; what `data_type: category`
  means), with a worked example of a two-level variable tree;
- `collections:` (documented for completeness, marked not used by this
  skill);
- **`curation-notes.md`** as an officially documented optional member of
  an STF directory: what it is for, that loaders ignore it, and its
  recommended structure (see below);
- **geocoordinates for EDA**: the latitude/longitude rules the `eda`
  profile enforces (one lat + one long per entity, `stable_id`
  `OBI_0001620`/`OBI_0001621`, `data_type` number/longitude,
  `display_type`), the lat/long column-name matching rules, and the six
  geohash columns the `eda` profile requires. The docs state that geohash
  columns are **optional in STF**: what matters is lat/long and their
  metadata, because `infer_geo_variables_for_eda()` (applied e.g. as
  `study %>% map_entities(infer_geo_variables_for_eda)` before `eda`
  validation or export) derives them, replacing any already present. STF
  exported by study-wrangler after that step will contain them, and that
  is fine;
- `display_type` and any other fields the `eda` profile checks;
- **code change in the same PR:** make `infer_geo_variables_for_eda()`
  idempotent (existing geohash columns are replaced, not duplicated by
  `bind_cols`) and a silent no-op on entities without coordinates (today
  it messages "No geographic coordinate variables detected" unless the
  entity is quiet), so `map_entities(infer_geo_variables_for_eda)` is
  safe on any study, with tests for both;
- the missing-value, date and longitude rules already present, kept.

The skill bundles a copy of these docs in `resources/stf/` (copied, not
linked, to keep the skill self-contained), recording the study-wrangler
tag it came from. Modes 1 and 2 both work from that copy; mode 3 will too.

## Deliverable B: the `tabular-to-stf` skill

### Inputs

- A folder of input tables (CSV or TSV, UTF-8, one header row, no missing
  cells), one file per entity, each with its own ID column and (for
  non-root entities) a parent ID column.
- Optional: a free-text study description (a paragraph, as the future web
  feature would collect), and/or a data dictionary in whatever form it
  arrives. The LLM reads these; there is no rigid parser.
- An output directory path chosen by the user.

### Outputs

An STF directory:

```
<out>/
├── study.yaml
├── entity-<name>.tsv / entity-<name>.yaml   (per entity)
└── curation-notes.md
```

### Mode 1 workflow

1. **Intake and profile.** A script profiles each input file: delimiter,
   columns, row count, per-column distinct values and counts, inferred type
   (reuse the rules in `shared/scripts/lib/stf.js` `inferType`, extended),
   candidate ID columns (unique, non-empty), and candidate parent links
   (columns whose values are all contained in another file's candidate ID
   column). Output is JSON for the LLM to read. *(My call)* The profile is
   capped so it stays readable at any input size: per column, at most ~20
   most frequent values with counts plus the distinct-value total, and
   min/max for numbers and dates. The LLM reads a few sample rows rather
   than whole files.
2. **Entity tree.** The LLM proposes entities (name, display name, plural),
   ID column and parent for each, from the profile plus file/column names
   and the study description. Each entity has exactly one parent; a parent
   may have several child types. Unambiguous structure is stated and the
   skill moves on; anything ambiguous (two plausible parents, no clear ID
   column, a name it is guessing at) is asked before continuing.
3. **Cleaning.**
   - *Routine normalisation, automatic:* trim leading/trailing whitespace;
     unify case/spelling variants of the same categorical value (e.g.
     `y`/`yes`/`YES` → `Yes`). Logged once per rule per column with a cell
     count. *(My call)* Unambiguous missing-value placeholders (`NA`,
     `N/A`, `n/a`, `-`, empty-looking strings) become empty cells under
     this rule; ambiguous ones (`unknown`, `none`, `0`, `not done`) carry
     meaning and go to the user for approval like any data-altering fix.
     (Inputs are expected to have no missing cells, but placeholders are
     how real tables encode them.) If the separate placeholder-scrubbing
     port to `lib/stf.js` lands first, reuse its rules.
   - *Likely typos, flagged:* near-duplicate categorical values (e.g.
     `Anopheles gambie` vs `Anopheles gambiae`), presented to the user, never
     auto-fixed.
   - *Data-altering fixes, approval required (all modes):* values that would
     otherwise force a type change or break a format, e.g. `80+` in an age
     column, `12..5`, `2023-13-01`, a stray text value in a numeric column.
     Batched per entity and shown to the user with a proposed fix; applied
     only on approval. Rejections are logged with what was done instead
     (e.g. "column kept categorical").
4. **Variable metadata.** For each variable: display name, `data_type`,
   `data_shape`, unit, definition, ordinal levels, categorical value order.
   Infer what the data shows; take what the description/dictionary says;
   ask for what remains and matters (a unit on a bare number, ordinal
   levels). Nice-to-haves (a definition) may be left blank. Questions are
   batched per entity, never one prompt per column.
5. **Geocoordinates.** For any entity with latitude/longitude (expected:
   collection sites, villages, households), write the lat/long metadata
   the `eda` profile expects (stable IDs, types, `display_type`; fixed
   values, no computation) and *(my call)* no geohash columns, since they
   are derived later by `infer_geo_variables_for_eda()` (see Deliverable
   A) and computing them here would only duplicate that. Make sure
   the wrangler's name matcher will find exactly one lat and one long per
   entity: columns it would miss, or misfire on (e.g. two "long" columns),
   are renamed or relabelled via the spec and the decision logged.
   `curation-notes.md` records that the study needs
   `map_entities(infer_geo_variables_for_eda)` before `eda` validation. Coordinates are checked for range (lat −90…90, long
   −180…180) and an obvious lat/long swap is raised with the user.
6. **Category tree.** For each entity with enough variables to benefit
   (rough threshold ~10; builder may tune), the LLM drafts a variable tree
   (named categories with definitions, nesting allowed), shows it to the
   user as an indented outline, applies edits, then writes it.
7. **Write STF.** A script renders the STF directory (see "Curation spec"
   below).
8. **Check.** `check-stf.js` runs (see "Checks"). Failures are fixed and the
   loop repeats until clean.
9. **Notes.** `curation-notes.md` is completed.

### Curation spec (architecture)

The LLM does not hand-write STF files. It writes one JSON **curation spec**
(entities, ID and parent columns, variable metadata, category tree, and an
ordered list of data transforms with their approval status), and a
deterministic script renders the input tables + spec → STF directory and the
mechanical parts of `curation-notes.md`. Rationale: rendering and ID
handling must be exact; re-running after a correction is cheap; the ordered
transform list is the replayable log the user asked for and a natural seed
for a mode 3 wrangler script.

The transform vocabulary starts small (trim, value map per column, cell
replacement by row ID, rename column) and is extended as the fixtures need.
"Whatever means necessary" is preserved by an escape hatch, *(my call)*
kept inside the spec so re-rendering never loses it: the vocabulary
includes a general `replace-cells` transform (entity, column, row IDs,
before → after, reason), and anything it can't express is added to the
vocabulary as a new transform rather than patched into rendered output.
The LLM may still munge freely while investigating, but every change that
reaches the output is a spec transform. Each one appears in
`curation-notes.md`, and the checks must still pass. (Exception: mode 2 on
a bare STF directory with no spec edits the STF files directly, since
nothing re-renders them; see Mode 2.)

The spec is saved alongside the output (e.g. `<out>/.curation-spec.json`)
so mode 2, or a later session, can re-render after changes. It is not
referenced from `study.yaml`, so loaders ignore it.

### `curation-notes.md`

Human-readable, in the STF directory. Sections (recommended structure, to be
documented in the STF docs):

- **Study**: the description supplied, and source files.
- **Entity tree**: as decided, with any user answers.
- **Routine normalisation**: per rule per column, with counts.
- **Data changes**: one entry per approved change: entity, column, row IDs,
  before → after, reason, approved by user; each written as a replayable
  pseudo-code step, e.g. `Participant.Age: "80+" → 80; add Age_censored =
  TRUE`. Rejected proposals and what was done instead.
- **Flagged, not changed**: likely typos and other issues left for a human.
- **Decisions and answers**: the user's answers to metadata questions;
  category tree decisions.
- **Validation** (mode 2): validator runs and outcomes.

### Checks (`check-stf.js`)

Zero-dependency, run after every render in all modes. Exits non-zero with a
readable list of problems.

- **ID integrity:** IDs unique per entity; every child row's parent ID exists
  in the parent entity; parent ID columns in each TSV match `id_columns` /
  `entity_level` in its YAML; the tree has exactly one root path per entity.
  Childless parents allowed.
- **Variable tree integrity:** every `parent_category` names an existing
  category in the same entity; no cycles; each variable/category appears
  once.
- **Structural loadability:** every TSV column (other than ID columns) has
  exactly one YAML variable and vice versa; `\\ Descriptors` on the entity's
  own ID column; filenames match `name` and the `study.yaml` entity list;
  `data_type`/`data_shape` and other enumerated fields use allowed values
  (*my call:* hard-coded constants in the script, with a test asserting
  they match the bundled STF docs; no machine-readable schema in
  Deliverable A for now, though a JSON Schema is a natural later step for
  mode 3 and the web feature); data values parse as their declared type;
  dates ISO-8601 without time.
- **EDA geo rules:** at most one lat and one long per entity by the
  wrangler's name-matching rules (ported to JS); their metadata as
  required; values in range. Geohash columns are allowed but produce a
  **warning**, not a failure: while the pin is 1.0.52 (before the
  idempotency fix) the warning says to drop them before mode 2
  validation, since the wrangler would duplicate them; from 1.0.53 it is
  informational only.

Target: if `check-stf.js` passes, `study_from_stf(dir, validate = FALSE)`
loads. The tests below hold that line.

### Mode 2

- Entered either after mode 1 or directly on an existing STF directory.
- Detects `docker` or `podman`; runs
  `veupathdb/study-wrangler:1.0.52` one-shot (`run --rm`, STF directory
  mounted; use `:Z` on SELinux podman hosts and run as the invoking user so
  outputs aren't root-owned), executing a small bundled R script that does
  `study_from_stf(dir, validate = FALSE)`, applies
  `map_entities(infer_geo_variables_for_eda)`, then validates with the
  `eda` profile and prints
  results in a form the skill can read.
- Loop: run `check-stf.js`, then the container validator. Metadata fixes
  (wrong type/shape, missing display name) are applied to the spec and
  logged. Data-altering fixes follow the same approval rule as mode 1.
  Re-render, re-validate. Stop when clean, when only user-blocked issues
  remain, or after a bounded number of rounds (builder's choice, ~5), and
  report what remains.
- If entered on an STF directory with no curation spec, fixes are made to
  the STF files directly and logged in `curation-notes.md` (created if
  absent).
- Reuse: `shared/scripts/lib/tools/exec.js` for process execution. The
  existing `tools/study-wrangler.js` resolves a local Rscript and validates
  one entity at a time; mode 2 needs a container runner and study-level
  validation, so add a sibling (e.g. `tools/study-wrangler-container.js`)
  rather than bending that one.

### Mode 3 slot (not implemented)

- `SKILL.md` lists mode 3 as "not yet available" with one paragraph on what
  it will be.
- `resources/mode-3-wrangler-script.md` holds the intent, the known
  prerequisites (study-wrangler self-documentation good enough for an LLM
  to write wrangler scripts; methods for any gaps), and how it relates to
  the shared pieces: the bundled STF docs, `check-stf.js`, and the
  `curation-notes.md` conventions. A mode-1 curation spec and its transform
  list can seed a wrangler script, but mode 3 does not depend on having one.
- Nothing in modes 1–2 should assume mode 3 runs after them.

### Skill layout (guide; builder may adjust)

```
skills/tabular-to-stf/
├── SKILL.md                      # modes, workflow, when to ask the user
├── resources/
│   ├── stf/                      # bundled copy of study-wrangler STF docs
│   ├── curation-spec.md          # spec schema + transform vocabulary
│   ├── cleaning.md               # normalisation / typo / approval rules
│   ├── variable-metadata.md      # how to fill each field; questions to ask
│   ├── category-tree.md          # how to draft and present the tree
│   ├── curation-notes.md         # the notes template
│   ├── mode-2-validation.md      # container use and fix loop
│   └── mode-3-wrangler-script.md # placeholder
└── scripts/
    ├── profile-tables.js
    ├── render-stf.js
    ├── check-stf.js
    └── validate-in-container.js  # mode 2
```

Generic STF writing (YAML scalar quoting, type inference) should be shared
with `shared/scripts/lib/stf.js` rather than duplicated; split that module
if needed so `sample-annotations-to-stf` keeps working unchanged.

## Testing

- **Fixtures:** two small synthetic datasets (~10–20 rows per entity),
  clinical-epi (Village, Household, Participant, Sample/Assay) and mosquito
  surveillance (Collection site, Collection, Sample, Assay), each with a
  study description, a hand-written curation spec, lat/long on the site or
  household level, and deliberate dirt:
  trailing whitespace, `y`/`yes`/`Yes`, a likely typo, `80+` in a numeric
  column. Plus small broken STF fixtures for `check-stf.js` (orphan child,
  duplicate ID, bad `parent_category`, tree cycle, TSV/YAML column
  mismatch).
- **Node tests (`yarn test`, always run):** profiler output; renderer output
  pinned with golden files; every `check-stf.js` failure case; transforms.
- **Container tests (opt-in, e.g. behind an env var, since they need
  docker):** render each fixture, then in `study-wrangler:1.0.52` assert
  `study_from_stf(dir, validate = FALSE)` loads, and, because the fixtures
  are clean once their spec is applied, that after
  `map_entities(infer_geo_variables_for_eda)` validation with the `eda`
  profile passes.
- **Scale smoke test:** a generated ~1M-row entity goes through profile,
  render and check in memory in reasonable time.
- **Skill run-through:** run the skill in Claude Code on each fixture in
  mode 1 and mode 2 and review the questions it asks and the notes it
  writes.

## Left to the builder

- Exact curation spec schema and transform vocabulary.
- Profile heuristics (ID detection, parent-link detection, typo distance).
- Category tree threshold.
- Container command details, output parsing, round limit.
- Fixture contents beyond the dirt listed above.
- Whether to split `lib/stf.js` and how.
