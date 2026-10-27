# Tabular-to-STF, Plan A: study-wrangler docs and geo idempotency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make study-wrangler's STF documentation the complete, definitive format reference, and make `infer_geo_variables_for_eda()` safe to map over any study, released as 1.0.53.

**Architecture:** One PR to `VEuPathDB/study-wrangler` (repo at `/home/maccallr/work/EDA/study-wrangler`, branch `stf-docs-and-geo-idempotency` off `main`). A small R change with testthat tests, a docs expansion guarded by a drift test, and a version bump. Humans merge, tag and release; Jenkins builds the `veupathdb/study-wrangler:1.0.53` image from the tag.

**Tech Stack:** R (S4, tidyverse), testthat, roxygen2. Run everything in the dev container per the repo's `CLAUDE.md` (`docker exec --user rstudio study-wrangler-dev R -e "..."`); start it with the `docker run ... --name study-wrangler-dev` command there if it isn't running.

**Spec:** `/home/maccallr/work/dataset-curator/docs/superpowers/specs/2026-10-24-tabular-to-stf-design.md` (Deliverable A).

## Global Constraints

- STF docs (`STF_documentation/`) are the single, definitive source of truth for the format.
- Geohash columns are **optional in STF**; `infer_geo_variables_for_eda()` derives them, replacing any already present.
- `curation-notes.md` becomes an officially documented optional member of an STF directory; loaders ignore it.
- Collections are documented for completeness, marked as not used by the tabular-to-stf skill.
- Release version: **1.0.53**.
- Never push to `main`; open a PR.

## Review Focus

1. Entity that already has geohash columns whose coordinates have since changed: re-running must recompute values, not keep stale ones.
2. Study where only some entities have coordinates: `map_entities(infer_geo_variables_for_eda)` must be silent on the others and change nothing there.
3. Round trip: infer → `export_to_stf()` → `study_from_stf()` → infer again → still exactly six geohash columns and `eda` validation passes.
4. Ambiguous coordinates (two "long" columns): keep today's warning and leave the entity unchanged; idempotency work must not swallow it.
5. A non-geo entity that is *not* quiet: must emit nothing (no message, no warning).

---

### Task 1: Idempotent, silent `infer_geo_variables_for_eda()`

**Files:**
- Modify: `R/Entity-methods-eda.R` (`infer_geo_variables_for_eda`, ~lines 64–166; roxygen above it)
- Test: `tests/testthat/test-entity-validators-eda-geocoords.R` (append), `tests/testthat/test-Study-methods.R` (append)

**Interfaces:**
- Produces: `infer_geo_variables_for_eda(entity)` that (a) returns a non-geo entity unchanged and emits nothing; (b) when geohash columns named in `get_config()$export$eda$stable_ids$geoaggregator` (`geohash_1`…`geohash_6`) already exist, drops them (data and metadata) before regenerating; (c) otherwise behaves as today.

- [ ] **Step 1: Write failing tests** (reuse the existing `add_geo_coords`-style helpers already in the geocoords test file)

```r
test_that("infer_geo_variables_for_eda is silent on an entity without coordinates", {
  households <- entity_from_file(system.file("extdata", "toy_example/households.tsv", package = 'study.wrangler'), name = 'household')
  expect_silent(result <- households %>% verbose() %>% infer_geo_variables_for_eda())
  expect_identical(result@data, households@data)
  expect_identical(result@variables, households@variables)
})

test_that("infer_geo_variables_for_eda is idempotent", {
  # households with lat/lng columns added, as in the existing tests
  once  <- geo_households %>% quiet() %>% infer_geo_variables_for_eda()
  twice <- once %>% quiet() %>% infer_geo_variables_for_eda()
  expect_identical(names(twice@data), names(once@data))
  expect_equal(sum(grepl("^geohash_", names(twice@data))), 6)
  expect_true(twice %>% quiet() %>% validate(profiles = c("baseline", "eda")))
})

test_that("infer_geo_variables_for_eda recomputes stale geohashes", {
  once <- geo_households %>% quiet() %>% infer_geo_variables_for_eda()
  moved <- once %>% modify_data(mutate(<lat column> = <lat column> + 10))  # use the lat column name in the fixture
  again <- moved %>% quiet() %>% infer_geo_variables_for_eda()
  expect_false(identical(again@data$geohash_6, once@data$geohash_6))
})

test_that("geohash columns survive an STF round trip and re-inference", {
  # infer -> export_to_stf(tmpdir) -> study_from_stf(tmpdir) -> map_entities(infer) -> eda-valid, 6 geohash cols
})
```

In `test-Study-methods.R`:

```r
test_that("map_entities(infer_geo_variables_for_eda) is safe on a mixed study", {
  # study with one geo entity and one non-geo entity, not quiet
  expect_no_message(result <- study %>% map_entities(infer_geo_variables_for_eda))
  # geo entity has 6 geohash columns; non-geo entity's data and variables are identical to before
})
```

Also add a test that two "long"-like columns still produce the existing warning and leave the entity unchanged (Review Focus 4).

- [ ] **Step 2: Run to verify failures**

Run: `docker exec --user rstudio study-wrangler-dev R -e "setwd('/study.wrangler'); devtools::load_all(); testthat::test_file('tests/testthat/test-entity-validators-eda-geocoords.R')"`
Expected: the new silent, idempotent and stale tests FAIL (message emitted; 12 geohash-like columns or a `bind_cols` rename message).

- [ ] **Step 3: Implement**

In Case 1 (no geo columns) return the entity with no `message()`. Before the `bind_cols` in Case 3, remove any existing columns named in `names(geoagg_ids)` from `entity@data` and their rows from `entity@variables`. Update the roxygen to say the function is idempotent and silent on non-geo entities, and that it is designed for `study %>% map_entities(infer_geo_variables_for_eda)`. Run `devtools::document()`.

- [ ] **Step 4: Run tests to verify they pass**

Run the Step 2 command, then the same for `test-Study-methods.R`, then the whole suite: `docker exec --user rstudio study-wrangler-dev R -e "setwd('/study.wrangler'); devtools::test()"`
Expected: all PASS, including the existing geocoords tests.

- [ ] **Step 5: Commit**

```bash
git checkout -b stf-docs-and-geo-idempotency
git add R/Entity-methods-eda.R man/ tests/testthat/test-entity-validators-eda-geocoords.R tests/testthat/test-Study-methods.R
git commit -m "infer_geo_variables_for_eda: idempotent and silent on non-geo entities"
```

---

### Task 2: Complete metadata field reference, with a drift test

**Files:**
- Modify: `STF_documentation/metadata-fields.md`
- Test: `tests/testthat/test-stf-documentation.R` (create)

**Interfaces:**
- Consumes: `variable_metadata_defaults` (`R/Entity-metadata-defaults.R`), the YAML handling in `R/entity_from_stf.R` and `R/study_from_stf.R`, and entity-level slots in `R/Entity-class.R`.
- Produces: `metadata-fields.md` documenting every YAML key the loaders read. The tabular-to-stf skill bundles this file and hard-codes allowed values from it.

- [ ] **Step 1: Write the failing drift test**

```r
test_that("metadata-fields.md documents every variable metadata field", {
  doc <- readLines(test_path("../../STF_documentation/metadata-fields.md"))
  internal_only <- c(<fields that never appear in YAML, e.g. entity_name, entity_level for variables, has_values; decide by reading entity_from_stf.R and list them here with a comment>)
  fields <- setdiff(names(variable_metadata_defaults), internal_only)
  undocumented <- fields[!map_lgl(fields, ~ any(grepl(paste0("`", .x, "`"), doc, fixed = TRUE)))]
  expect_equal(undocumented, character(0))
})

test_that("metadata-fields.md lists every allowed data_type and data_shape", {
  # take the factor levels from variable_metadata_defaults$data_type / $data_shape (and display_type, hidden)
  # assert each level appears in backticks in the doc
})
```

If the package doesn't ship `STF_documentation/` in installed builds, guard with `skip_if_not(file.exists(...))` so `R CMD check` doesn't fail; it runs under `devtools::test()`.

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec --user rstudio study-wrangler-dev R -e "setwd('/study.wrangler'); devtools::load_all(); testthat::test_file('tests/testthat/test-stf-documentation.R')"`
Expected: FAIL listing undocumented fields (`definition`, `unit`, `ordinal_levels`, `vocabulary_order`, `is_multi_valued`, `display_order`, `hidden`, `stable_id`, `display_type`, …).

- [ ] **Step 3: Write the reference**

For each field: type, required/optional, default, allowed values, when to use it, and a YAML example where the shape isn't obvious (lists such as `ordinal_levels`, `vocabulary_order`, `hidden`). Cover `parent_category` (alias of internal `parent_variable`), `multi_value_delimiter`, and the entity-level keys (`name`, `display_name`, `display_name_plural`, `stable_id`, and any others the loader reads). Add `study.yaml` keys beyond `name`/`entities` if `study_from_stf.R` reads more.

- [ ] **Step 4: Run to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add STF_documentation/metadata-fields.md tests/testthat/test-stf-documentation.R
git commit -m "STF docs: complete metadata field reference with a drift test"
```

---

### Task 3: Format docs: categories, collections, EDA geocoordinates, curation notes

**Files:**
- Modify: `STF_documentation/Study-Transfer-Format-STF.md`
- Test: `tests/testthat/test-stf-documentation.R` (append)

**Interfaces:**
- Produces: the sections the skill's bundled copy relies on. Section headings exactly: `## Variable categories (the variable tree)`, `## Collections`, `## Geocoordinates for EDA`, `## Curation notes (curation-notes.md)`.

- [ ] **Step 1: Write the failing test.** The worked category example in the docs must load. Put the example in the doc between `<!-- example:categories:tsv -->` / `<!-- example:categories:yaml -->` fenced blocks. The test extracts both blocks, writes them to a temp STF directory with a `study.yaml`, and asserts `study_from_stf(dir)` loads and validates. Do the same for a `## Geocoordinates for EDA` example (lat/long only, no geohash columns): it must load, and after `map_entities(infer_geo_variables_for_eda)` must pass `validate(profiles = c("baseline", "eda"))`.

- [ ] **Step 2: Run to verify it fails** (the headings and markers don't exist yet). Same command as Task 2.

- [ ] **Step 3: Write the sections**
  - **Variable categories:** the `categories:` list keyed `category:` (not `variable:`; quote the loader's error), with `display_name`, `definition`, `parent_category`. Explain nesting, that categories have `data_type: category` and no data column, that variables join a category with `parent_category`, and the validators that apply. Include a two-level worked example.
  - **Collections:** what `collections:` is and its keys, marked "not produced by the tabular-to-stf skill".
  - **Geocoordinates for EDA:** cover all of these:
    - the lat/long name-matching rules (copy the tables from the `infer_geo_variables_for_eda` roxygen);
    - one latitude and one longitude per entity;
    - the required `stable_id` (`OBI_0001620` / `OBI_0001621`), `data_type` (`number` / `longitude`) and `display_type`;
    - geohash columns `geohash_1`…`geohash_6` (`EUPATH_0043203`…`EUPATH_0043208`, `display_type: geoaggregator`, hidden everywhere) are **optional in STF**: `infer_geo_variables_for_eda()` derives them and replaces any already present;
    - the recommended step `study %>% map_entities(infer_geo_variables_for_eda)` before `eda` validation or VDI export.
  - **Curation notes:** `curation-notes.md` is an optional member of an STF directory, ignored by loaders. Recommended sections: Study; Entity tree; Routine normalisation; Data changes (each a replayable pseudo-code step, e.g. `Participant.Age: "80+" → 80; add Age_censored = TRUE`); Flagged, not changed; Decisions and answers; Validation.
  - Extend the directory-structure example with `curation-notes.md`, and keep the existing missing-value, date and longitude rules.

- [ ] **Step 4: Run to verify it passes**, then the full suite (`devtools::test()`). Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add STF_documentation/Study-Transfer-Format-STF.md tests/testthat/test-stf-documentation.R
git commit -m "STF docs: categories, collections, EDA geocoordinates, curation notes"
```

---

### Task 4: Version 1.0.53 and PR

**Files:**
- Modify: `DESCRIPTION` (`Version: 1.0.53`)

- [ ] **Step 1:** Bump the version and run `devtools::check()` in the container. Expected: no ERRORs and no new WARNINGs compared with `main`.
- [ ] **Step 2:** Commit with the message `version 1.0.53`.
- [ ] **Step 3:** Push the branch and open a PR. The body summarises the three changes and states that the tabular-to-stf skill in dataset-curator will pin `veupathdb/study-wrangler:1.0.53` once it's tagged and the image is on Docker Hub.
- [ ] **Step 4:** Stop. Tagging `v1.0.53` and confirming the image are for humans (Plan B, Task 11 waits on them).
