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

Each dataset type module declares its workspace directory name
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
    "Rscript -e 'install.packages(\"study.wrangler\", repos=NULL, lib=Sys.getenv(\"BUILD_DIR\"))'"
  ]
}
```

- **repos**: name → `url`, `ref`, optional `followsRebuild`. The name is the
  directory under `repos/` and under each proposal or load directory.
- **executables**: absolute paths to system interpreters. They are not code
  under test and stay outside the workspace. Each is checked for existence
  before use.
- **build**: shell commands run in order with `cwd` set to the proposal or
  load directory, so worktrees are reachable by relative path. The skill sets
  `BUILD_DIR` (that directory's `build/`) and `PROPOSAL_DIR` (the directory
  itself).

One `env.json` per type serves both verify and load. Schema v1 files are
rejected with a message telling the loader to migrate; there is no v1 shim.

### Which ref a worktree uses

| Phase  | `followsRebuild: true` | otherwise |
|--------|------------------------|-----------|
| Verify | `origin/<ref>`         | `origin/<ref>` |
| Load   | `origin/rebuild<RR>`   | `origin/<ref>` |

Repos with their own versioning (study.wrangler, Nextflow workflows) pin a
tag in `ref` and use it in both phases. A `followsRebuild` repo with no
`rebuild<RR>` branch is an error naming the repo; there is no fallback to
`ref`.

VEuPathDatasets is not listed: it is the curation workspace the skills run
in, and validators read proposal content from `origin/master` through git.
If a validator later needs a build of it, it becomes an ordinary
`followsRebuild` entry.

## Verify lifecycle

1. **Base clone.** If `repos/<name>` is missing, clone it from `url`. Base
   clones are never checked out or edited; they are a fetch cache and the root
   for worktrees.
2. **Create.** If `proposals/<accession>/` does not exist: `git fetch origin`
   in each base clone, `git worktree add -b verify/<accession>
   proposals/<accession>/<name> origin/<ref>`, then run the build commands.
   A new verification always starts from the latest code.
3. **Reuse.** If `proposals/<accession>/` exists (re-verification after a
   revision), it is used as is: no fetch, no reset, no rebuild. In-progress
   fixes survive. The report records each repo's SHA, so staleness is visible.
4. **`--rebuild`.** Re-runs the build commands in place, after the loader
   patches code in a worktree.
5. **`--refresh`.** Fetches and moves each worktree to the current
   `origin/<ref>`, then rebuilds. Refuses if any worktree has uncommitted
   changes or commits not on a remote branch.
6. **request-revision.** Leaves the proposal directory in place.
7. **mark-ready.** Takes `--workspace <root>`. Refuses if any worktree has
   uncommitted changes or unpushed commits, listing them per repo, so the
   loader pushes and opens a PR upstream or discards. `--discard-changes`
   is the only override. On success it runs `git worktree remove` for each
   repo, deletes the `verify/<accession>` branches from the base clones, and
   removes `proposals/<accession>/`.

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
4. **start-build.js** removes `loads/rebuild<RR>/` for every type, so each
   build starts from fresh tool code, and removes any `loads/rebuild<other>/`.

A dirty load worktree at refresh or removal is an error, not a silent
discard: nobody should have edited it.

## Tool resolution

Resolvers stop reading paths from `env.json`. A workspace handle gives them
the active directory (proposal or load), its worktrees by repo name,
`BUILD_DIR` and the executables:

- ApiCommonData is `<dir>/ApiCommonData`; its version is the worktree's SHA.
- study.wrangler's R library is `BUILD_DIR`.
- The Perl module symlink tree for ApiCommonData's parser is created under
  `BUILD_DIR` instead of `os.tmpdir()`.

Reports record every repo's resolved SHA and ref, alongside the executables'
versions.

## Errors

Every workspace failure becomes `could not verify: <reason>` for each affected
tool, never a proposal finding:

- root not given, type directory missing, `env.json` missing, invalid or v1
- clone or fetch failure
- `followsRebuild` repo with no `rebuild<RR>` branch
- executable missing
- build step N failed (with the tail of its stderr)

Load still refuses on any of these, as it does today. The mark-ready and
`--refresh` dirty/unpushed guards are hard stops.

## Code

- `shared/scripts/lib/validation-workspace.js` (new): layout, type directory
  routing, base clones, worktree create/reuse/refresh/remove, dirty and
  unpushed checks, build runs. Takes an injected `exec`.
- `shared/scripts/lib/validation-env.js`: parses and checks `env.json` v2 and
  resolves tools against a workspace handle.
- `shared/scripts/lib/tools/*.js`: resolve from the handle, not from env paths.
- Dataset type modules declare their workspace directory name.
- `validate-proposal.js`, `load-proposal.js`: `--workspace <root>`, plus
  `--rebuild` and `--refresh`.
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
- request-revision leaves the directory
- `followsRebuild` resolution; missing `rebuild<RR>` branch errors
- load workspace shared across two loads; `start-build.js` reset and stale
  rebuild removal
- build step failure, missing executable, v1 `env.json` and missing type
  directory each yield `could not verify`

## Migration

`/home/jbrestel/test_validation` is replaced by
`dataset-validation-workspaces/rnaseq-validation/` with a v2 `env.json`,
drafted and approved by the loader before it is written. The ApiCommonData
checkout in `eda_oracle_migration` stops being referenced.
