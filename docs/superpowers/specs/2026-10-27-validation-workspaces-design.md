# Validation Workspaces

## Problem

A validation workspace today is one flat directory holding `validation-env.json`
(schema v1): absolute paths to an ApiCommonData checkout, perl, Rscript and an
optional R library, all living elsewhere. Every dataset type shares it, the
workspace owns none of the code it validates with, scratch files go to
`os.tmpdir()`, and nothing ties a validation to a reproducible code state
beyond the SHA of whatever checkout happened to be there.

Annotated genome verification will need to change tool code during
verification and build it. That needs isolated, per-proposal code and build
environments that the skill creates and removes.

## Layout

The data loader names one root. Each dataset type has its own directory under
it.

```
dataset-validation-workspaces/          # --workspace <root>
  rnaseq-validation/
    env.json                            # repos, executables, build commands
    repos/<repo>/                       # base clone: fetch cache, never edited
    proposals/<accession>/              # verify: one per proposal, editable
      <repo>/                           # git worktree on branch verify/<accession>
      build/                            # this proposal's build env
    loads/rebuild<RR>/                  # load: shared by all loads in a rebuild
      <repo>/                           # detached worktree
      build/
  annotated-genome-validation/
    ...
```

The per-type validation registry (`dataset-types/validators.js`, beside each
type's validators) declares its workspace directory name
(`bulk-rnaseq` → `rnaseq-validation`, `genome-assembly` →
`annotated-genome-validation`). The skill picks the directory from the
proposal manifest's `datasetType`. A missing type directory is an error naming
the directory to create; there is no fallback.

The root is never guessed, searched for or defaulted. The data loader names it.

## env.json (schema v2)

```json
{
  "schemaVersion": 2,
  "repos": {
    "ApiCommonData":     { "url": "git@github.com:VEuPathDB/ApiCommonData.git", "ref": "master", "followsRebuild": true },
    "ApiCommonWorkflow": { "url": "git@github.com:VEuPathDB/ApiCommonWorkflow.git", "ref": "master", "followsRebuild": true },
    "study.wrangler":    { "url": "git@github.com:VEuPathDB/study.wrangler.git", "ref": "v1.4.2" }
  },
  "executables": {
    "perl": "/usr/bin/perl",
    "rscript": "/usr/bin/Rscript"
  },
  "build": [
    "mkdir -p \"$BUILD_DIR/lib/R\" && Rscript -e 'install.packages(\"study.wrangler\", repos=NULL, lib=file.path(Sys.getenv(\"BUILD_DIR\"), \"lib/R\"))'"
  ]
}
```

- **repos**: name → `url`, `ref`, optional `followsRebuild`. The name is the
  directory under `repos/` and under each proposal or load directory: it
  matches `[A-Za-z0-9._-]+` and is not `.`, `..` or `build`.
- **executables**: absolute paths to system interpreters. They are not code
  under test and stay outside the workspace. Each is checked for existence
  before use.
- **build** (optional): shell commands run in order with `cwd` set to the
  proposal or load directory, so worktrees are reachable by relative path. The
  skill sets `BUILD_DIR` (that directory's `build/`), `PROPOSAL_DIR` (the
  directory itself), `GUS_HOME=$BUILD_DIR` and `PROJECT_HOME=$PROPOSAL_DIR`,
  so VEuPathDB-style builds install into the workspace, never the caller's
  `GUS_HOME`. Builds install into `BUILD_DIR` in the installed layout, not the
  source layout: `ApiCommonData/Load/bin/*` lands in `build/bin/`, Perl
  modules under `build/lib/perl/` by package name.

One `env.json` per type serves both verify and load. Schema v1 files are
rejected with a message telling the loader to migrate; there is no v1 shim.

### Which ref a worktree uses

| Phase  | `followsRebuild: true` | otherwise |
|--------|------------------------|-----------|
| Verify | `ref`, resolved in order | `ref`, resolved in order |
| Load   | `origin/rebuild<RR>` only | `ref`, resolved in order |

`ref`, resolved in order: the branch `origin/<ref>`, then the tag `<ref>`,
then `<ref>` as a 7–40 hex commit sha; anything else is an error.

Repos with their own versioning (study.wrangler, Nextflow workflows) pin a
tag in `ref` and use it in both phases. At load, a `followsRebuild` repo with
no `origin/rebuild<RR>` branch is an error naming the repo; there is no
fallback to a tag, sha or `ref`.

VEuPathDatasets is not listed: it is the curation workspace the skills run
in, and validators read proposal content from `origin/master` through git.
If a validator later needs a build of it, it becomes an ordinary
`followsRebuild` entry.

## Verify lifecycle

1. **Base clone.** If `repos/<name>` is missing, clone it from `url`. Base
   clones are never checked out or edited; they are a fetch cache and the root
   for worktrees.
2. **Create.** If `proposals/<accession>/` does not exist: `git fetch --force
   --prune --tags origin` in each base clone, `git worktree add -b
   verify/<accession> proposals/<accession>/<name> <resolved ref>`, then run
   the build commands. A new verification always starts from the latest code.
   A worktree created or moved voids `build/.built`.
3. **Reuse.** If `proposals/<accession>/` exists (re-verification after a
   revision), it is used as is: no fetch, no reset, no rebuild. In-progress
   fixes survive. The report records each repo's SHA, so staleness is visible.
4. **`--rebuild`.** Re-runs the build commands in place, after the loader
   patches code in a worktree.
5. **`--refresh`.** Fetches and moves each worktree to its current resolved
   ref, then rebuilds. Refuses if any worktree has uncommitted changes or
   commits on no remote branch or tag, or if `verify/<accession>` in any base
   clone holds such commits, even when the worktree's HEAD is on another
   branch.
6. **request-revision.** Leaves the proposal directory in place.
7. **mark-ready.** The accession must be a plain directory name.
   `--workspace <root>` is required for types with validators;
   `--discard-changes` requires `--workspace`. Before any ticket change it
   refuses a missing type directory, and refuses if any worktree has
   uncommitted changes or commits on no remote branch or tag, or if
   `verify/<accession>` in any base clone holds such commits even when the
   worktree's HEAD is on another branch, listing them per repo, so the
   loader pushes and opens a PR upstream or discards. `--discard-changes` is
   the only override. Once the ticket is Ready it runs `git worktree remove`
   for each repo, deletes the `verify/<accession>` branches from the base
   clones, and removes `proposals/<accession>/`. A removal failure then is a
   warning naming the directory, exit 0; the loader removes it by hand. With
   no `proposals/<accession>/`, mark-ready notes that there is no workspace
   for the accession.

The skill never pushes to tool repos.

## Load lifecycle

Load re-runs the content validators against the code the build will use, and
never edits code, so proposals in one rebuild share a workspace.

1. **Create.** The first `load-proposal.js` for `rebuild<RR>` fetches each
   base clone, adds a detached worktree per repo at the load ref from the table
   above under `loads/rebuild<RR>/`, and runs the build commands.
2. **Reuse.** Later loads in the same rebuild reuse it without fetching, so
   every proposal in the rebuild validates against the same SHAs.
3. **`--refresh`** on `load-proposal.js` deletes and recreates
   `loads/rebuild<RR>/` when a tool fix lands mid-build. This changes the code
   under every later load in that rebuild.
4. **`start-build.js --workspace <root> reset-load-workspaces`** (no other
   flags) removes every `loads/rebuild<digits>/` of every type, so each build
   starts from fresh tool code; other entries in `loads/` are ignored. It is
   all-or-nothing: an edited load workspace anywhere means nothing is
   removed. It opens no PR; run it after `merge-back` merges.

mark-ready takes `--workspace` only for types with validators; for a type
without a workspace directory it removes nothing.

A dirty load worktree at refresh or removal is an error, not a silent
discard: nobody should have edited it.

## Tool resolution

Resolvers stop reading paths from `env.json`. A workspace handle gives them
the active directory (proposal or load), its worktrees by repo name,
`BUILD_DIR` and the executables:

- Tools and build commands run from the build, not the source tree:
  `build/bin` first on `PATH`; `GUS_HOME=build/`, `PERL5LIB=build/lib/perl`
  and `R_LIBS=build/lib/R`, not inherited, so a stray `GUS_HOME` in the
  caller's environment can never shadow the worktree's code.
- R dependencies (tidyverse and the like) still come from the user and site
  libraries, which would take too long to build per proposal. study.wrangler itself must
  load from `build/lib/R`; a copy found anywhere else is "could not verify".
- A build that finishes writes `build/.built`; a workspace without it is
  built again on next use, so a failed build never passes for a good one.
- ApiCommonData's parser modules are found at
  `build/lib/perl/ApiCommonData/Load/`. The installed layout already matches
  their package names, so the `os.tmpdir()` symlink tree is deleted.
- Versions are the worktrees' SHAs; the build is derived from them.

Reports record tool versions (the ApiCommonData sha, the study.wrangler
package version) plus `repos: { <name>: { ref, sha } }`. The addition is
additive, so `REPORT_SCHEMA_VERSION` stays 1.

## Errors

Every workspace failure becomes `could not verify: <reason>` for each affected
tool, never a proposal finding:

- root not given, type directory missing, `env.json` missing, invalid or v1
- accession not a plain directory name
- clone or fetch failure
- `followsRebuild` repo with no `rebuild<RR>` branch
- executable missing
- build step N failed (with the tail of its stderr)

In validate-proposal a workspace failure yields a `fail` report, posted on the
ticket unless `--no-post`. Load still refuses on any of these, as it does
today. The mark-ready and
`--refresh` dirty/unpushed guards are hard stops.

## Code

- `shared/scripts/lib/validation-workspace.js` (new): layout, type directory
  routing, base clones, worktree create/reuse/refresh/remove, dirty and
  unpushed checks, build runs. Takes an injected `exec`.
- `shared/scripts/lib/validation-env.js`: parses and checks `env.json` v2 and
  resolves tools against a workspace handle.
- `shared/scripts/lib/tools/*.js`: resolve from the handle, not from env paths.
- `shared/scripts/dataset-types/validators.js`: maps each dataset type to its
  workspace directory.
- `validate-proposal.js`: `--workspace <root>`, `--refresh`, `--rebuild`.
- `load-proposal.js`: `--workspace <root>`, `--refresh`.
- `mark-ready.js`: `--workspace <root>`, `--discard-changes`.
- `start-build.js`: load workspace reset.
- verify-bulk-rnaseq and load-proposals SKILL.md and resources: describe the
  root, the layout and the new flags.

All of it lives in `shared/` and syncs into the skills.

## Testing

Unit tests use throwaway local bare repos as `url` remotes, in temp
directories, with no network:

- clone if missing; existing base clone fetched, never checked out
- verify worktree creation on `verify/<accession>`; reuse without fetch
- `--rebuild` reruns build only; `--refresh` moves to the new ref and refuses
  when dirty or unpushed
- mark-ready guard: dirty, unpushed, `--discard-changes`; cleanup removes
  worktrees, branches and the directory
- disposal and refresh guard the verify branch when the worktree moved
- request-revision leaves the directory
- ref resolution order: branch, tag, sha, else error
- `followsRebuild` resolution; missing `rebuild<RR>` branch errors
- load workspace shared across two loads; `start-build.js` reset and stale
  rebuild removal; reset is all-or-nothing
- build step failure, missing executable, v1 `env.json` and missing type
  directory each yield `could not verify`

## Migration

`/home/jbrestel/test_validation` is replaced by
`dataset-validation-workspaces/rnaseq-validation/` with a v2 `env.json`,
drafted and approved by the loader before it is written. The ApiCommonData
checkout in `eda_oracle_migration` stops being referenced.
