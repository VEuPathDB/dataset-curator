# Tabular-to-STF, Plan B: the `tabular-to-stf` skill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude skill that turns a folder of one-file-per-entity CSV/TSV tables into an EDA-bound STF directory without R (mode 1), and optionally validates and fixes it in the pinned study-wrangler container (mode 2), with an empty slot for mode 3.

**Architecture:** The LLM writes a JSON **curation spec** (entities, metadata, category tree, ordered data transforms). Zero-dependency Node modules profile the inputs, apply the transforms, and render the spec to STF and `curation-notes.md`. `check-stf.js` enforces ID, tree, structure and geo rules. A container runner validates with study-wrangler's `eda` profile after `map_entities(infer_geo_variables_for_eda)`. Library code lives in `shared/` (tested there) and is synced into `skills/tabular-to-stf/` via `package.json` `sharedFiles`.

**Tech Stack:** Node ≥18 ESM, standard library only; `node --test`; docker/podman + `veupathdb/study-wrangler` for mode 2 and opt-in tests.

**Spec:** `docs/superpowers/specs/2026-10-24-tabular-to-stf-design.md` (Deliverable B). Plan A (`2026-10-24-tabular-to-stf-A-study-wrangler.md`) is independent except for Task 11.

## Global Constraints

- Scripts: pure JavaScript, Node stdlib only, no npm dependencies, `#!/usr/bin/env node` and executable; follow `docs/development.md`.
- No VEuPathDatasets checkout, no `check-workspace.js`, no git operations in this skill.
- Study-wrangler image `veupathdb/study-wrangler:1.0.52`; version in one constant; moves to 1.0.53 in Task 11.
- Validation always `validate(study, profiles = c("baseline", "eda"))` after `map_entities(study, infer_geo_variables_for_eda)`.
- Input files are never modified. Every change that reaches the output is a spec transform.
- Inputs up to ~1M records per entity, in memory. The model reads only capped profiles and sample rows.
- Geohash columns are not written by the skill; `check-stf` warns (never errors) if present.
- Data-altering transforms need `"approval": "user"`; only routine ones may be `"auto"`.
- Existing `sample-annotations-to-stf` output must stay byte-identical (`tests/fixtures/stf/` pins it).

## Review Focus

1. **CSV quoting**: fields with commas, doubled quotes or embedded newlines must parse as one cell. Tested in Task 3.
2. **CRLF line endings and a UTF-8 BOM** on input: no `\r` in values, and the BOM is not part of the first header. Tested in Task 3.
3. **IDs and codes with leading zeros** (`007`, `0123`): ID columns are always strings; a variable whose values have leading zeros is profiled with a `leadingZeros` flag and rendered `string` unless the spec says otherwise. Tested in Tasks 4 and 7.
4. **YAML-special strings** in display names, definitions and vocabularies (`yes`, `no`, `on`, `off`, `null`, `1.0`, `a: b`, a leading `#` or `-`) must survive the render → yaml-lite parse round trip. Tested in Tasks 1, 2 and 7.
5. **Tabs or newlines inside a value** must not reach a TSV: render fails and names the entity, column and row ID. Tested in Task 7.

---

## File map

| File | Responsibility |
|---|---|
| `shared/scripts/lib/stf-common.js` | `yamlScalar`, `inferType`, `makeRName`, `uniqueRNames` (moved/extended from `lib/stf.js`) |
| `shared/scripts/lib/yaml-lite.js` | Parse the YAML subset STF uses |
| `shared/scripts/lib/tabular/read-table.js` | CSV/TSV reading |
| `shared/scripts/lib/tabular/profile.js` | Column profiles, ID and parent-link candidates |
| `shared/scripts/lib/tabular/spec.js` | Spec validation and the constants it needs |
| `shared/scripts/lib/tabular/transforms.js` | Apply ordered transforms, produce a change log |
| `shared/scripts/lib/tabular/geo.js` | Port of the wrangler's lat/long name matcher, geo constants |
| `shared/scripts/lib/tabular/stf-constants.js` | Allowed enumerated values |
| `shared/scripts/lib/tabular/render.js` | Spec + tables → STF file texts |
| `shared/scripts/lib/tabular/notes.js` | `curation-notes.md` text |
| `shared/scripts/lib/tabular/check.js` | STF directory checks |
| `shared/scripts/lib/tools/study-wrangler-container.js` | Engine detection, container args, validation run |
| `shared/scripts/lib/tools/study-wrangler-validate-study.R` | R run inside the container |
| `shared/scripts/profile-tables.js`, `render-stf.js`, `check-stf.js`, `validate-stf-in-container.js` | CLIs |
| `skills/tabular-to-stf/SKILL.md`, `resources/*.md`, `resources/stf/*` | The skill (not shared) |
| `tests/tabular-*.test.js`, `tests/fixtures/tabular/` | Tests and fixtures |

Each new shared file gets a `sharedFiles` entry listing `tabular-to-stf`. `lib/stf-common.js` is also listed for every skill that already receives `lib/stf.js`. Run `yarn sync-shared` before each commit (the pre-commit hook does it, but the `skill-imports` test needs it in the working tree).

---

### Task 1: `stf-common.js` (shared STF helpers)

**Files:**
- Create: `shared/scripts/lib/stf-common.js`
- Modify: `shared/scripts/lib/stf.js` (import from stf-common instead of defining locally), `package.json`
- Test: `tests/tabular-stf-common.test.js`

**Interfaces:**
- Produces:
  - `yamlScalar(value: string|number) → string`: as today, and it also quotes `on`, `off`, `y`, `n` (case-insensitive), any string containing `\n`, and leading `+` or `.`+digit numerics.
  - `inferType(values: string[]) → { data_type, data_shape }`: today's rules, plus values with a leading zero (`/^0\d/`) are `string`/`categorical`.
  - `makeRName(header: string) → string`: R's `make.names` for one name. Every character outside `[A-Za-z0-9._]` becomes `.`. Prefix `X` if the name starts with a digit, with `_`, or with `.` followed by a digit, or if it is empty. Append `.` to R reserved words (`if`, `else`, `repeat`, `while`, `function`, `for`, `next`, `break`, `TRUE`, `FALSE`, `NULL`, `Inf`, `NaN`, `NA`, `NA_integer_`, `NA_real_`, `NA_character_`, `in`).
  - `uniqueRNames(headers: string[]) → string[]`: `make.names(unique = TRUE)`; a duplicate gets `.1`, `.2`, … in order.

- [ ] **Step 1: Write failing tests**

```js
test('makeRName matches R make.names', () => {
  assert.equal(makeRName('Age (years)'), 'Age..years.');
  assert.equal(makeRName('1st visit'), 'X1st.visit');
  assert.equal(makeRName('_id'), 'X_id');
  assert.equal(makeRName('if'), 'if.');
  assert.equal(makeRName('participant_id'), 'participant_id');
});
test('uniqueRNames dedupes like make.names(unique = TRUE)', () => {
  assert.deepEqual(uniqueRNames(['a b', 'a.b', 'a b']), ['a.b', 'a.b.1', 'a.b.2']);
});
test('yamlScalar quotes YAML 1.1 booleans and multi-line text', () => {
  for (const s of ['on', 'OFF', 'y', 'N', 'yes', 'null', '1.0', 'a: b', '#x', '-x']) assert.match(yamlScalar(s), /^'/);
  assert.equal(yamlScalar("it's"), "it's");
  assert.equal(yamlScalar('a\nb').startsWith("'"), true);
});
test('inferType keeps leading-zero codes as strings', () => {
  assert.deepEqual(inferType(['007', '012']), { data_type: 'string', data_shape: 'categorical' });
});
```

Cross-check `makeRName` expectations against real R in the container once (Task 9 has the container setup); record the R output in a test comment.

- [ ] **Step 2: Run** `node --test tests/tabular-stf-common.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Move `yamlScalar` and `inferType` out of `lib/stf.js` and import them back there. The `yamlScalar` extension can change quoting of existing sample-annotation outputs only for the newly quoted words; if `tests/fixtures/stf/` changes, stop and check that it's only those. Add `sharedFiles` entries.
- [ ] **Step 4: Run** `yarn sync-shared && yarn test`. Expected: all PASS, including the existing `artifacts` STF golden and `skill-imports`.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: shared STF helpers (make.names, YAML quoting)`.

---

### Task 2: `yaml-lite.js`

**Files:**
- Create: `shared/scripts/lib/yaml-lite.js`
- Test: `tests/tabular-yaml-lite.test.js`

**Interfaces:**
- Produces: `parseYaml(text: string) → any`. This is the subset STF uses:
  - block mappings, and block sequences, including sequences of mappings (`- key: v`);
  - plain, single-quoted and double-quoted scalars (double-quoted with `\"`, `\\`, `\n`, `\t` escapes);
  - flow sequences of scalars (`[]`, `[a, 'b c']`) and `{}`;
  - block scalars `|`, `>`, `|-`, `>-`;
  - full-line and trailing ` #` comments.

  Plain scalars become numbers if they're `-?\d+` or decimal, booleans for `true`/`false` (case-insensitive), and `null` for `null`, `~` or an empty value. Everything else, including `yes`/`no`, stays a string; R's `yaml` turns those into booleans, which is why `yamlScalar` quotes them on output.
  Anything else (anchors `&`, aliases `*`, tags `!`, `---` documents after the first, flow mappings with content) throws `YamlLiteError` with `.line`.

- [ ] **Step 1: Write failing tests.** Parse the existing `tests/fixtures/stf/entity-sample.yaml`. Parse the YAML examples in `skills/sample-annotations-to-stf/...` and the STF docs examples (copy them inline into the test). Do the round trip `parseYaml(yamlScalar(s)) === s` for the Review Focus 4 strings. Check that each unsupported construct throws with the right line.
- [ ] **Step 2: Run** `node --test tests/tabular-yaml-lite.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** as an indentation-based line parser; no regex-only shortcuts for nesting.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: minimal YAML reader`.

---

### Task 3: `read-table.js`

**Files:**
- Create: `shared/scripts/lib/tabular/read-table.js`
- Test: `tests/tabular-read-table.test.js`

**Interfaces:**
- Produces: `readTable(path: string) → { file, delimiter: ',' | '\t', headers: string[], rows: string[][] }` and `parseDelimited(text, delimiter) → { headers, rows }`.
  - The delimiter comes from the extension: `.csv` gives `,`, and `.tsv`/`.txt` give tab.
  - Otherwise use whichever of tab and comma appears more often in line 1.
  - CSV follows RFC 4180: quoted fields, `""` escapes and embedded newlines.
  - TSV has no quoting.
  - Strip a UTF-8 BOM and treat `\r\n` as a line break.
  - Drop a trailing empty last line.
  - A row whose cell count differs from the header's throws with the file and line number.
  - Values are not trimmed (trimming is a transform).

- [ ] **Step 1: Write failing tests** for Review Focus 1–2: `a,"b,c","d ""e"""` → `['a','b,c','d "e"']`, a quoted field containing `\n`, BOM + CRLF input, a ragged row error with its line number, and TSV with a literal `"` kept.
- [ ] **Step 2: Run** and confirm the tests FAIL.
- [ ] **Step 3: Implement** a char-by-char state machine for CSV, and `split('\t')` per line for TSV.
- [ ] **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: CSV/TSV reader`.

---

### Task 4: Profiler and `profile-tables.js`

**Files:**
- Create: `shared/scripts/lib/tabular/profile.js`, `shared/scripts/profile-tables.js`
- Test: `tests/tabular-profile.test.js`

**Interfaces:**
- Consumes: `readTable`, `inferType`.
- Produces:
  - `profileTables(tables: Table[], { topN = 20, sampleRows = 5 }) → Profile`.
  - `Profile = { files: [{ file, delimiter, rowCount, headers, sampleRows: string[][], columns: [ColumnProfile] }], parentLinks: [{ file, column, refFile, refColumn }] }`.
  - `ColumnProfile = { header, distinctCount, top: [{ value, count }] (≤ topN, by count desc then value), inferred: { data_type, data_shape }, min?, max? (numbers and ISO dates), isCandidateId (all values unique, none empty), leadingZeros (bool), whitespaceCells (leading/trailing space count), placeholderCells: { [value]: count } for values in PLACEHOLDERS, nearDuplicates: [[a, b]...] }`.
  - `PLACEHOLDERS = ['NA','N/A','n/a','na','-','--','.','null','NULL','none','None','unknown','Unknown','not done']`, with `UNAMBIGUOUS_PLACEHOLDERS = ['NA','N/A','n/a','na','-','--','.','null','NULL']`. Export both from `profile.js`; `spec.js` imports them.
  - `nearDuplicates`: for categorical columns with ≤ 200 distinct values, pairs equal after lower-casing and trimming, and pairs with Levenshtein distance ≤ 2 where both are ≥ 5 chars.
  - `parentLinks`: column C in file F links to candidate ID column K in another file G when every value of C is in K, and C is not itself F's only candidate ID.
  - CLI: `profile-tables.js <inputDir> [--top N]` reads every `.csv`/`.tsv`/`.txt` in the directory and prints the profile JSON to stdout.

- [ ] **Step 1: Write failing tests** on a tiny inline 3-file dataset (village / household / participant):
  - `household.village_id → village.village_id` link found;
  - IDs flagged as candidates;
  - `y`/`Yes`/`yes ` gives a near-duplicate pair and a whitespace count;
  - `"80+"` makes an age column `string` and its `top` includes `80+`;
  - leading-zero codes flagged;
  - `top` capped at `topN` while `distinctCount` stays exact.
- [ ] **Step 2: Run** and confirm the tests FAIL.
- [ ] **Step 3: Implement.** Profile in one pass per column using `Map` counts. Don't keep extra copies of rows; Task 8's scale test runs over this code.
- [ ] **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: input profiler`.

---

### Task 5: Curation spec and transforms

**Files:**
- Create: `shared/scripts/lib/tabular/spec.js`, `shared/scripts/lib/tabular/transforms.js`, `shared/scripts/lib/tabular/stf-constants.js`
- Test: `tests/tabular-spec.test.js`, `tests/tabular-transforms.test.js`

**Interfaces:**
- Produces the **spec schema** (JSON; documented verbatim in `skills/tabular-to-stf/resources/curation-spec.md` in Task 10):

```jsonc
{
  "specVersion": 1,
  "study": { "name": "string", "description": "string?" },
  "inputDir": "path, relative to the spec file or absolute",
  "entities": [{
    "name": "participant",                 // /^[a-z][a-z0-9_]*$/, unique
    "displayName": "Participant", "displayNamePlural": "Participants",
    "file": "participants.csv",
    "idColumn": "participant_id",          // header after renames
    "parent": "household",                 // omitted for the root; exactly one root
    "parentColumn": "household_id",
    "geo": { "latitude": "lat", "longitude": "lon" },   // optional
    "variables": [{
      "column": "age",                     // header after renames
      "displayName": "Age",
      "dataType": "integer", "dataShape": "continuous",  // optional: inferred if absent
      "unit": "years", "definition": "…",
      "ordinalLevels": ["low","mid","high"], "vocabularyOrder": ["No","Yes"],
      "isMultiValued": false, "multiValueDelimiter": ",",
      "parentCategory": "demographics", "stableId": "…", "displayType": "…"
    }],
    "categories": [{ "category": "demographics", "displayName": "Demographics", "definition": "…", "parentCategory": "…?" }]
  }],
  "transforms": [ /* ordered; see below */ ],
  "notes": { "flagged": ["…"], "decisions": ["…"], "pii": ["…"], "validation": ["…"] }
}
```

- `STF_CONSTANTS` in `stf-constants.js`:

```js
DATA_TYPES = ['string','number','integer','date','longitude']
DATA_SHAPES = ['continuous','categorical','ordinal','binary']
DISPLAY_TYPES = ['default','multifilter','geoaggregator','latitude','longitude']
HIDDEN = ['download','variableTree','map','everywhere']
```

- **Transforms.** Every transform has `op`, `entity`, `reason` and `approval` (`"auto"` | `"user"` | `"proposed"` | `"rejected"`), plus `instead` (string) when `rejected`. `proposed` and `rejected` are not applied.

| op | fields | `auto` allowed |
|---|---|---|
| `trim` | `columns?` (default all) | yes |
| `blank-placeholders` | `columns?`, `values` | only if `values ⊆ UNAMBIGUOUS_PLACEHOLDERS` |
| `map-values` | `column`, `map` `{from: to}` | yes (the skill docs restrict it to spelling/case variants) |
| `rename-column` | `from`, `to` | yes |
| `replace-cells` | `column`, `cells: [{ id, from, to }]` | no |
| `parse-dates` | `column`, `format` (tokens `DD`, `D`, `MM`, `M`, `YYYY`, any separators) | no |
| `derive-column` | `column` (new), `from`, `map`, `default` | no |
| `drop-column` | `column` | no |

- `validateSpec(spec) → string[]` (errors). It checks:
  - schema shape and the enumerations;
  - one root, every `parent` names an entity, no cycles;
  - category references exist within the entity and have no cycles;
  - `auto` is only used where the table above allows it;
  - transform `entity` names exist.

  It does not read files.
- `applyTransforms(tables: Map<entityName, {headers, rows}>, spec) → { tables, log: [{ index, op, entity, column?, approval, cellsChanged, ids?: string[] }] }`. It mutates copies, never the inputs.
  - `replace-cells` throws if a cell's current value ≠ `from` (the spec is stale) or the ID is missing.
  - `parse-dates` throws listing the row IDs that don't match `format` or give invalid calendar dates.
  - Output dates are `YYYY-MM-DD`.

- [ ] **Step 1: Write failing tests**
  - `validateSpec`: a valid minimal spec gives `[]`; two roots; parent cycle; unknown `parentCategory`; category cycle; `replace-cells` with `approval: "auto"`; `blank-placeholders` `auto` with `"unknown"`; bad `dataType`.
  - `applyTransforms`:
    - each op on a small table;
    - `proposed`/`rejected` are skipped and still logged with `cellsChanged: 0`;
    - stale `replace-cells` throws naming the row ID;
    - `parse-dates` `DD/MM/YYYY` gives `03/04/2023 → 2023-04-03`, and `31/02/2023` throws;
    - `derive-column` `{ from: 'age', map: { '80+': 'TRUE' }, default: 'FALSE' }` followed by `replace-cells` `80+ → 80` gives both columns right;
    - the input arrays are unchanged afterwards.
- [ ] **Step 2: Run** `node --test tests/tabular-spec.test.js tests/tabular-transforms.test.js` and confirm the tests FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: curation spec and transforms`.

---

### Task 6: Geo matcher

**Files:**
- Create: `shared/scripts/lib/tabular/geo.js`
- Test: `tests/tabular-geo.test.js`

**Interfaces:**
- Produces:
  - `isLatitudeName(name: string) → boolean` and `isLongitudeName(name: string) → boolean`: a port of `infer_geo_variables_for_eda`'s matcher. Case-insensitive token `latitude|lat` (or `longitude|long|lng`), bounded on each side by a word boundary or `_`. The regex is `(\b|_)token(\b|_)`, the same as R.
  - `GEO = { latitude: { stableId: 'OBI_0001620', dataType: 'number', displayType: 'latitude' }, longitude: { stableId: 'OBI_0001621', dataType: 'longitude', displayType: 'longitude' }, geohashColumns: ['geohash_1', …, 'geohash_6'] }`.

- [ ] **Step 1: Write failing tests** using every example row from the matched and not-matched tables in the `infer_geo_variables_for_eda` roxygen (`lat-dd`, `wgs84_lat`, `sample_lat_value`, `latitude-wgs84`, `lng_dd`, `long-dd`, `sample_long`, `longitude_wgs84`; not matched: `lat1`, `lng2`, `platform`, `flat`, `slat`, `belongs`, `elongated`, `latlong`).
- [ ] **Step 2: Run** and confirm the tests FAIL. **Step 3: Implement.** **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: wrangler lat/long name matcher`.

---

### Task 7: Render STF and notes; fixtures; `render-stf.js`

**Files:**
- Create: `shared/scripts/lib/tabular/render.js`, `shared/scripts/lib/tabular/notes.js`, `shared/scripts/render-stf.js`
- Create fixtures: `tests/fixtures/tabular/clinical-epi/{inputs/*.csv, description.md, spec.json, expected/*}` and `tests/fixtures/tabular/mosquito/{inputs/*.tsv, description.md, spec.json, expected/*}`
- Test: `tests/tabular-render.test.js`

**Interfaces:**
- Consumes: `readTable`, `validateSpec`, `applyTransforms`, `inferType`, `uniqueRNames`, `yamlScalar`, `GEO`, `isLatitudeName`/`isLongitudeName`.
- Produces:
  - `renderStf(spec, tables) → { files: { [name]: text }, log }`. `files` holds `study.yaml`, `entity-<name>.tsv`, `entity-<name>.yaml` and `curation-notes.md`. It throws a `RenderError` with a list of messages.
  - `renderNotes(spec, log) → string`.
  - CLI: `render-stf.js <spec.json> <outDir>`. It reads the inputs, renders, and writes every file plus `<outDir>/.curation-spec.json` (a copy of the spec). It refuses an `outDir` that is non-empty and has no `.curation-spec.json`. It prints the files written and exits 1 with the messages on error.

**Rendering rules** (decisions the implementer cannot infer):
- **Output column names.** Within each entity, `uniqueRNames` runs over the ID columns then the variable columns. Every variable's `provider_label` is `[original header]`. The ID header is `<name> \\ Descriptors`, with a literal backslash-backslash-space between the name and `Descriptors`, as in `lib/stf.js`.
- **ID columns.** A child TSV has the parent's ID first, then its own ID. The parent ID column takes the **parent entity's output ID column name**, renamed if it clashes. The YAML `id_columns` lists the parent with `entity_level: -1`, then the entity itself. ID values are always strings.
- **Unaccounted columns.** Every non-ID column after transforms must appear in `variables`, or the render fails with "unaccounted column <entity>.<header>". This prevents silent loss.
- **Types.** `dataType`/`dataShape` default to `inferType` on the transformed values. If a declared type doesn't parse every non-empty value, the render fails, listing up to 10 bad values with their row IDs.
- **Geo.** For `geo.latitude` and `geo.longitude`:
  - the output column is `latitude` / `longitude` if `makeRName(header)` fails `isLatitudeName` / `isLongitudeName`, and stays as it is otherwise;
  - set `stable_id`, `data_type` and `display_type` from `GEO`;
  - after naming, any *other* column in the entity matching either matcher is an error that names it and suggests a `rename-column`.

  In entities without `geo`, two or more columns that match either matcher is an error.
- **Values.** A value containing `\t`, `\n` or `\r` is an error naming the entity, column and row ID (Review Focus 5). Empty strings are written as empty cells.
- **YAML key order** per variable: `variable`, `provider_label`, `display_name`, `definition`, `data_type`, `data_shape`, `unit`, `ordinal_levels`, `vocabulary_order`, `is_multi_valued`, `multi_value_delimiter`, `parent_category`, `stable_id`, `display_type`. Absent keys are omitted. Entity YAML ends with `categories:` (a list, or `[]`). `study.yaml` is `name` plus `entities` in tree order (pre-order from the root, with siblings in spec order).
- **`curation-notes.md`** sections, in this order: `## Study` (name, description, source files and row counts), `## Entity tree` (indented outline), `## Routine normalisation` (log entries with `approval: auto`, one line per op per column, with counts), `## Data changes` (`user` entries as replayable pseudo-code lines such as ``- `participant.age`: "80+" → 80 (rows P017, P021). Reason: …``, then `proposed` as "Proposed, not applied" and `rejected` with `instead`), `## Flagged, not changed` (`notes.flagged` + `notes.pii`), `## Decisions and answers` (`notes.decisions`), and `## Validation` (`notes.validation`, or "Not run (mode 1)"). If any entity has `geo`, the notes add a line under Study: "Before `eda` validation or export, run `map_entities(study, infer_geo_variables_for_eda)`".

**Fixtures** (synthetic, 10–20 rows per entity, author them by hand):
- `clinical-epi`: `villages.csv` (village_id, name, lat, lon), `households.csv` (household_id, village_id, construction material, number of rooms, …), `participants.csv` (participant_id, household_id, sex, age with one `80+`, bednet use as `y`/`Yes`/`yes ` with a trailing space, a typo `Feamle`, enrolment date as `DD/MM/YYYY`, …), `samples.csv` (sample_id, participant_id, collection date, temperature °C, hemoglobin g/dL, malaria RDT result). Participants should have at least 10 variables so a category tree is exercised.
- `mosquito`: `collection_sites.tsv` (site_id, Latitude, Longitude, habitat), `collections.tsv` (collection_id, site_id, date, method, trap nights), `samples.tsv` (sample_id, collection_id, species with a near-duplicate `Anopheles gambie`, sex, count), `assays.tsv` (assay_id, sample_id, assay type, insecticide, mortality %, kdr genotype). Include an ID with leading zeros (`S007`-style is fine, but also one pure-digit code column like `0123`) and a value with a YAML-special string (`yes`/`on` in a vocabulary, `a: b` in a definition).
- Each `spec.json` resolves every piece of dirt through transforms: one of each op across the two fixtures, plus one `rejected` and one `proposed` entry. Each has a category tree for the largest entity.

- [ ] **Step 1: Write failing tests**
  - golden: `renderStf` on each fixture equals `expected/` byte for byte (read every file; write a helper that names the first differing file and line);
  - `parseYaml` on every rendered YAML gives back the spec's display names and definitions exactly (Review Focus 4);
  - unaccounted column, bad declared type, tab in a value, stray `long_term_resident` column in a geo entity, and a non-geo entity with `lat` + `latitude`: each throws `RenderError` with the expected message;
  - an ID with leading zeros (`0123`) stays `0123`;
  - the CLI refuses a non-empty `outDir` without `.curation-spec.json` and re-renders into one that has it.
- [ ] **Step 2: Run** `node --test tests/tabular-render.test.js` and confirm the tests FAIL.
- [ ] **Step 3: Implement** `render.js`, `notes.js` and the CLI. Generate `expected/` with the CLI (`node shared/scripts/render-stf.js tests/fixtures/tabular/<ds>/spec.json tests/fixtures/tabular/<ds>/expected`), **read every generated file**, and check by hand that each piece of dirt was resolved as intended before committing them as golden.
- [ ] **Step 4: Run** `yarn sync-shared && yarn test` and confirm everything PASSES.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: render spec to STF and curation notes, with fixtures`.

---

### Task 8: `check-stf.js`

**Files:**
- Create: `shared/scripts/lib/tabular/check.js`, `shared/scripts/check-stf.js`
- Test: `tests/tabular-check.test.js`

**Interfaces:**
- Consumes: `parseYaml`, `parseDelimited`, `STF_CONSTANTS`, `isLatitudeName`/`isLongitudeName`, `GEO`, `STUDY_WRANGLER_VERSION` (Task 9; until Task 9 exists, define it in `check.js` and move it).
- Produces:
  - `checkStf(dir: string) → { errors: string[], warnings: string[] }`.
  - CLI: `check-stf.js <stfDir> [--json]` prints `ERROR: …` / `WARNING: …` lines (or the JSON) and exits 1 if there are errors.

**Checks** (each error message names the file and, for data, the row ID):
- **Structure.**
  - `study.yaml` exists, with `name` and `entities`.
  - Each listed entity has `entity-<name>.tsv` and `.yaml`, and the YAML `name` matches.
  - Full STF only: no YAML gives the error "STF-lite not supported; validate in mode 2".
  - Wide only: no header ending ` \\ Descriptors` gives the error "tall or malformed TSV; validate in mode 2".
  - The Descriptors column is the entity's own ID (`entity_level` 0).
  - TSV and YAML columns correspond one-to-one: ID columns ↔ `id_columns`, the rest ↔ `variables`.
  - Rows have the header's cell count.
- **Enumerations.** `data_type`, `data_shape`, `display_type` and `hidden` are drawn from `STF_CONSTANTS`. `ordinal` requires `ordinal_levels`.
- **Values.** Non-empty values parse as their `data_type`:
  - `date` is a valid `YYYY-MM-DD`;
  - `longitude` is a number in −180…180;
  - a latitude (`display_type: latitude`) is in −90…90;
  - `ordinal` values are in `ordinal_levels`.
- **IDs.**
  - Own IDs are non-empty and unique.
  - Each ancestor ID column's `entity_name` is a study entity, and its `entity_level` matches the tree derived from the immediate-parent links.
  - Every value of an ancestor ID column exists in that ancestor's ID column.
  - Every entity except one root has an `entity_level: -1` column.
  - No cycles. Childless parents are fine.
- **Variable tree.**
  - Every `parent_category` names a category in the same entity.
  - Category parents form no cycle.
  - Each variable and category name is unique within the entity.
- **Geo.** Per entity, count the names that match each matcher (variable name or any `provider_label`).
  - More than one latitude or more than one longitude is an error.
  - A latitude/longitude pair must have the `GEO` `stable_id`, `data_type` and `display_type`.
  - A lone match is a warning ("check for a mislabelled coordinate").
  - Any `geohash_1…6` column is a **warning**. While `STUDY_WRANGLER_VERSION < 1.0.53` it reads "geohash columns present; drop them before mode 2 validation, since study-wrangler <1.0.53 would duplicate them". From 1.0.53 it reads "geohash columns present; they will be recomputed by infer_geo_variables_for_eda()".

- [ ] **Step 1: Write failing tests.** Both rendered golden fixtures pass with `errors: []`. Then, by copying a golden fixture to a temp dir and mutating one thing each, these must each produce the named error:
  - orphan child row;
  - duplicate ID;
  - TSV column missing from the YAML;
  - YAML variable missing from the TSV;
  - bad `data_type`;
  - `2023-02-30` in a date column;
  - `parent_category` naming nothing;
  - category cycle;
  - `entity_level: -2` on an immediate parent;
  - two latitude-like columns;
  - wrong latitude `stable_id`;
  - missing `study.yaml` entity file.

  Also: adding `geohash_1` gives a warning only; a childless parent row is fine; a grandchild that lists both ancestors correctly passes.
- [ ] **Step 2: Run** and confirm the tests FAIL. **Step 3: Implement.** **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Scale smoke test (opt-in).** `tests/tabular-scale.test.js`, skipped unless `STF_SCALE_TEST=1`. It generates a 2-entity dataset: 1,000 parents and 1,000,000 children with 8 columns of mixed types, written to a temp dir. Then it runs `profileTables`, `renderStf` (minimal spec) and `checkStf`, asserting completion with no errors. Run `STF_SCALE_TEST=1 node --test tests/tabular-scale.test.js` and record the wall time and peak RSS (`process.memoryUsage().rss`) in the test's output. Expected: PASS within the default heap. If it doesn't, fix the hot spot. Don't raise the limit.
- [ ] **Step 6: Commit** with the message `tabular-to-stf: STF checker`.

---

### Task 9: Container validation (mode 2)

**Files:**
- Create: `shared/scripts/lib/tools/study-wrangler-container.js`, `shared/scripts/lib/tools/study-wrangler-validate-study.R`, `shared/scripts/validate-stf-in-container.js`
- Test: `tests/tabular-container.test.js`

**Interfaces:**
- Consumes: `defaultExec`, `failureOutput` from `lib/tools/exec.js`.
- Produces:
  - `STUDY_WRANGLER_VERSION = '1.0.52'`; `STUDY_WRANGLER_IMAGE = 'veupathdb/study-wrangler:' + STUDY_WRANGLER_VERSION`.
  - `detectEngine({ exec, preferred }) → 'docker' | 'podman' | null`. It tries `<engine> version`, docker first unless `preferred` is given.
  - `containerArgs(engine, stfDir, scriptPath) → string[]` returns `['run','--rm','-v',`${abs(stfDir)}:/stf:ro${z}`,'-v',`${abs(scriptPath)}:/sw/validate-study.R:ro${z}`, STUDY_WRANGLER_IMAGE,'Rscript','/sw/validate-study.R','/stf']`, where `z = engine === 'podman' ? ',Z' : ''`. The mounts are read-only, so no files are created as root.
  - `validateStudyInContainer(stfDir, { engine, exec }) → { status: 'pass' | 'fail' | 'load-error', output: string }`. `status` comes from the marker line, and `output` is the full stdout+stderr.
  - CLI: `validate-stf-in-container.js <stfDir> [--engine docker|podman]` prints the output and then `Result: <status>`. It exits 0 on pass, 1 on fail, 2 on load-error and 3 when no engine is found. `validate-stf-in-container.js --detect` prints the engine or `none`.

- `study-wrangler-validate-study.R` does the following, without `%>%`:
  1. Load the library quietly.
  2. Run `study_from_stf(dir, validate = FALSE)` inside `tryCatch`. On error, print `STF_LOAD_ERROR: <message>` and quit with status 2.
  3. `study <- map_entities(study, infer_geo_variables_for_eda)`.
  4. `ok <- validate(study, profiles = c("baseline", "eda"))`.
  5. If not ok, loop over `get_entities(study)`, printing `== entity: <name> ==` and running `validate(verbose(entity), profiles = c("baseline", "eda"))`. Study-level validation hides entity details.
  6. Print `STF_VALIDATION: PASS` or `STF_VALIDATION: FAIL` and quit with status 0 or 1.

- [ ] **Step 1: Write failing unit tests** with a stub `exec`:
  - `containerArgs` for docker and podman (exact arrays);
  - `detectEngine` falls back to podman when docker throws, and returns `null` when both throw;
  - status parsing for each marker, and a non-zero exit with no marker gives `load-error` carrying the output.
- [ ] **Step 2: Run** and confirm the tests FAIL. **Step 3: Implement.** **Step 4: Run** and confirm the tests PASS.
- [ ] **Step 5: Opt-in integration tests**, skipped unless `STF_CONTAINER_TESTS=1`:
  - each golden fixture's `expected/` gives `status: 'pass'` (this proves `validate = TRUE` with `eda` on clean fixtures);
  - a copy with an orphan child row does not pass;
  - a copy that passes `checkStf` but has all optional metadata stripped (no units, definitions or categories) still loads, i.e. status is not `load-error`. That's the mode-1 bar.

  Run `docker pull veupathdb/study-wrangler:1.0.52 && STF_CONTAINER_TESTS=1 node --test tests/tabular-container.test.js`. Expected: PASS. If a golden fixture fails `eda` validation, fix the renderer or the fixture spec, regenerate the golden files (Task 7 Step 3 procedure) and rerun all tests. Also run the `makeRName` R cross-check from Task 1 here.
- [ ] **Step 6: Commit** with the message `tabular-to-stf: container validation for mode 2`.

---

### Task 10: The skill: SKILL.md, resources, bundled STF docs, registration

**Files:**
- Create: `skills/tabular-to-stf/SKILL.md` and the following under `skills/tabular-to-stf/resources/`:
  - `curation-spec.md`
  - `cleaning.md`
  - `variable-metadata.md`
  - `category-tree.md`
  - `curation-notes.md`
  - `mode-2-validation.md`
  - `mode-3-wrangler-script.md`
  - `stf/Study-Transfer-Format-STF.md`
  - `stf/metadata-fields.md`
  - `stf/SOURCE.md`
- Modify: `package.json` (`sharedFiles` for the four CLIs and all of their `lib/` imports), `README.md` (Available Skills), `docs/development.md` (Shared Library table rows), `CLAUDE.md` (repository structure tree)
- Test: `tests/tabular-skill.test.js`

**Interfaces:**
- Consumes: the four CLIs: `node skills/tabular-to-stf/scripts/{profile-tables,render-stf,check-stf,validate-stf-in-container}.js`.

- [ ] **Step 1: Write failing tests**
  - Every value in `STF_CONSTANTS` appears in backticks in the bundled `resources/stf/metadata-fields.md`, except the names in `KNOWN_UNDOCUMENTED_IN_1_0_52` (a constant in the test; Task 11 empties it and deletes it).
  - `SOURCE.md` names the same version as `STUDY_WRANGLER_VERSION`.
  - Every relative link in `SKILL.md` and `resources/*.md` resolves inside the skill.
  - The `SKILL.md` frontmatter `name` is `tabular-to-stf`.
- [ ] **Step 2: Run** and confirm the tests FAIL.
- [ ] **Step 3: Bundle the docs:** `git -C /home/maccallr/work/EDA/study-wrangler show v1.0.52:STF_documentation/<file>` for both files. `SOURCE.md` records the tag, the date and "update with Task 11 when the pin moves".
- [ ] **Step 4: Write `SKILL.md`** (well under 5,000 words). Frontmatter description: "Convert multi-entity relational tabular data (CSV/TSV, one file per entity, e.g. village/household/participant/sample or collection site/collection/sample/assay) into STF for study-wrangler and VEuPathDB EDA; optionally validate and fix it in a study-wrangler container". Body:
  - **Inputs:** an input folder, an optional study description, an optional data dictionary in any format, and an output directory.
  - **Choosing a mode:** run `--detect`; mode 1 by default; offer mode 2 when an engine exists; mode 2 alone on an existing STF directory; mode 3 "not yet available" with one paragraph.
  - **Mode 1 steps 1–9 from the design**, each one paragraph linking its resource. Steps 1–8 below, then step 9, Notes.
    1. Profile. Read the profile JSON, not whole files.
    2. Entity tree. State the unambiguous parts; ask before any wild guess.
    3. Cleaning (`cleaning.md`).
    4. Variable metadata (`variable-metadata.md`). Batch questions per entity.
    5. Geo (the paragraph in `variable-metadata.md`).
    6. Category tree (`category-tree.md`). Show an indented outline, ~10+ variables.
    7. Write the spec (`curation-spec.md`) to `<out>/.curation-spec.json` and run `render-stf`.
    8. `check-stf`. Loop until clean.
  - **The rule:** never hand-edit rendered STF; change the spec and re-render. Exception: mode 2 on a directory with no spec.
  - **PII:** mention it once, gently, and record it in `notes.pii`.
- [ ] **Step 5: Write the resources.**
  - `curation-spec.md` is the Task 5 schema and transform table, verbatim.
  - `cleaning.md` covers:
    - auto vs user approval;
    - `UNAMBIGUOUS_PLACEHOLDERS` vs ambiguous placeholders;
    - near-duplicates are flagged, not fixed;
    - batch data-altering fixes per entity, with a proposed fix for each;
    - log rejections with `instead`.
  - `variable-metadata.md` covers:
    - each field: when to infer, when to ask, when to leave it blank;
    - how to read a free-form data dictionary;
    - the geo rules: what the renderer sets, rename false matches, range and swap checks, and asking the user about a suspected lat/long swap.
  - `category-tree.md` covers how to draft the tree, an example outline, and the threshold.
  - `curation-notes.md` covers the section list and what goes in `notes.*`.
  - `mode-2-validation.md` covers:
    - `check-stf` first, then the container;
    - mapping validator messages to spec edits (metadata fixes are applied and logged; data fixes need approval);
    - re-render, revalidate, at most 5 rounds, then report what remains;
    - the bare-STF case: edit files directly and create or append to `curation-notes.md`.
  - `mode-3-wrangler-script.md` is the design's mode 3 section: intent, prerequisites, relation to shared pieces, and that it is a parallel route.
- [ ] **Step 6: Register:** add `sharedFiles` entries for each CLI and every module it imports, transitively, with target `tabular-to-stf`. Then `yarn sync-shared`, and update `README.md`, `docs/development.md` and `CLAUDE.md`.
- [ ] **Step 7: Run** `yarn test`. Expected: all PASS, including `skill-imports`.
- [ ] **Step 8: Skill run-through.** In a fresh Claude Code session in this repo, ask: "convert the tables in tests/fixtures/tabular/clinical-epi/inputs to STF in tmp/clinical-epi-stf, here's the study description: <contents of description.md>". Check that:
  - the skill activates;
  - it asks before guessing the tree only where something is ambiguous;
  - it batches questions;
  - it proposes the `80+` fix rather than applying it;
  - it flags `Feamle`;
  - `check-stf` passes;
  - with docker present, mode 2 reaches `pass`.

  Repeat with `mosquito`. Record what went wrong and fix the resource wording. Don't change the scripts to fit one run.
- [ ] **Step 9: Commit** with the message `tabular-to-stf: skill, resources and bundled STF docs`.

---

### Task 11: Move the pin to 1.0.53 (blocked on Plan A release)

**Precondition:** `v1.0.53` is tagged in study-wrangler, and `docker pull veupathdb/study-wrangler:1.0.53` succeeds.

**Files:**
- Modify: `shared/scripts/lib/tools/study-wrangler-container.js` (`STUDY_WRANGLER_VERSION = '1.0.53'`), `skills/tabular-to-stf/resources/stf/*` (re-bundle from `v1.0.53`), `tests/tabular-skill.test.js` (delete `KNOWN_UNDOCUMENTED_IN_1_0_52`)

- [ ] **Step 1:** Re-bundle the docs from `v1.0.53` and update `SOURCE.md`. Bump the constant and delete the exemption list.
- [ ] **Step 2:** Update the check's geohash warning test to expect the 1.0.53 wording.
- [ ] **Step 3: Run** `yarn sync-shared && yarn test && STF_CONTAINER_TESTS=1 node --test tests/tabular-container.test.js`. Expected: all PASS.
- [ ] **Step 4:** Add a container test showing that the pin's geo step is now idempotent: a golden fixture with geohash columns added still gives `status: 'pass'`. Run it and confirm it PASSES.
- [ ] **Step 5: Commit** with the message `tabular-to-stf: pin study-wrangler 1.0.53 and its STF docs`.
