# Multi-organism RNA-seq proposals

Date: 2026-10-05
Status: approved design, not yet planned

## Problem

Host–parasite studies align one BioProject's samples to more than one
reference genome, often in different VEuPathDB projects (PlasmoDB and
HostDB). Today a bulk RNA-seq proposal with `--also-organism`:

- has one `project`, so a host organism in HostDB fails the organism
  cross-check against a PlasmoDB proposal;
- renders one presenter per organism, where the live convention is one
  presenter with one injector per dataset;
- delivers the same samplesheet, analysisConfig and STF to every organism,
  so uninfected controls land in the parasite dataset.

A BioProject with several species that the curator splits across genomes is
the same problem: each sample belongs to some of the proposal's organisms.

## Reference: Lee_Gambian

`Model/lib/xml/datasetPresenters/PlasmoDB.xml` holds the only live presenter
(the HostDB.xml copy is commented out):

```xml
<datasetPresenter name="HPI_Lee_Gambian_ebi_rnaSeq_RSRC" datasetNamePattern="%_Lee_Gambian_ebi_rnaSeq_RSRC">
  ...shared text, contacts, links, pubmed...
  <templateInjector projectName="PlasmoDB" datasourceName="pfal3D7_Lee_Gambian_ebi_rnaSeq_RSRC" ...>
  <templateInjector projectName="HostDB"   datasourceName="hsapREF_Lee_Gambian_ebi_rnaSeq_RSRC" ...>
</datasetPresenter>
```

The presenter element has no `projectName`. Injector props differ per
dataset (switchStrandsProfiles, showIntronJunctions, includeInUnifiedJunctions,
isDESeq, excludedProfileSets, projectAvailability). The two `<dataset>`
entries, in `PlasmoDB/pfal3D7.xml` and `HostDB/hsapREF.xml`, are identical.

## Decisions

1. One proposal, one ticket, one branch, keyed by the accession. No
   suffixed proposal id: a species split is a multi-organism proposal whose
   organisms share no samples.
2. `project` belongs to each organism, not the proposal (manifest v4).
3. A multi-organism proposal renders one presenter with one injector per
   organism. A single-organism proposal renders exactly as today.
4. Sample membership is a per-sample fact in the sample annotations, stated
   by the curator. Each organism's samplesheet, analysisConfig and STF are
   derived from it.
5. `dataset.json` stays shared across organisms.
6. Per-organism references (annotation tags, presenter overrides, curated
   subdirectories) use `proposedOrganismAbbrev`. Rendering maps each to its
   settled `organismAbbrev`, so Phase 2 settlement renames nothing on disk.

## Manifest v4

```json
"organisms": [
  { "proposedOrganismAbbrev": "pfal3D7", "source": "loaded", "project": "PlasmoDB" },
  { "proposedOrganismAbbrev": "hsapREF", "source": "loaded", "project": "HostDB" }
]
```

- Root `project` is removed. Each organism has a `project` from
  `valid-projects.json`.
- `organisms[0]` is the home organism: its project's presenter file holds the
  presenter. The skill lists the parasite first.
- `SUPPORTED_SCHEMA_VERSIONS` becomes `[4]`. A v3 manifest is refused with
  "re-run write-proposal.js", as for the v2 legacy keys.
- Genome proposals carry `project` on their single organism; their
  one-organism cap is unchanged.

### Where each organism's project comes from

`write-proposal.js` keeps `--project`, which names the home organism's
project. For a loaded-type organism, the cross-check resolves its project
from the rebuild branch's organism index or, failing that, from the pending
genome proposal that claims it, and records it. The home organism's resolved
project must equal `--project`. `--also-organism` stays a bare abbreviation.
An abbreviation found in no project is an error, as today. For a genome
(new organism) the project is `--project`.

### Consumers of `m.project`

Each becomes per organism, or the home organism's project where one value is
needed:

| Consumer | Becomes |
|---|---|
| `organisms.js` cross-check, conflicts, `loadedProblem` | the organism's project |
| `dataset-classes.js` `identityValues` | the organism's project |
| `load-ops.js` dataset file path, existence and name checks | the organism's project |
| `load-ops.js` presenter file path and name check | home project |
| `proposal-ops.js` dataset name check | the organism's project |
| Ticket title, commit and PR messages, `list-proposals.js` | distinct projects, home first, joined with `, ` |
| Genome and RNA-seq presenter `projectName` | the organism's project |

## Sample membership

Each sample in `<accession>_sample_annotations.json` may carry
`organisms`, a list of proposed abbreviations.

- Two or more organisms: every sample must have a non-empty `organisms`
  list naming only manifest organisms, and every organism must be named by at
  least one sample. `write-proposal` refuses otherwise. There is no default,
  so a forgotten tag stops the run instead of putting controls into a
  parasite dataset.
- One organism: `organisms` is optional and means that organism.

Step 2 (analyze samples) asks the curator which case applies and writes the
tags:

- (a) every sample to every organism;
- (b) uninfected or control samples to the host only;
- (c) each sample to its own organism(s).

A sample that belongs to no organism is removed from the annotations, not
left untagged.

## Curated artifacts

Derived per organism, filtered to that organism's samples, under
`curated/<proposedOrganismAbbrev>/`:

```
curated/pfal3D7/samplesheet.csv
curated/pfal3D7/analysisConfig.xml
curated/pfal3D7/entity-sample.tsv
curated/pfal3D7/entity-sample.yaml
curated/hsapREF/...
```

- Single-organism proposals use the same layout, so there is one code path.
- `derivedCuratedFiles` stays the four base names; `deriveArtifacts` keys
  its output `<abbrev>/<file>`. The keep/replace hand-edit protection works
  per file as now.
- `checkCurated` runs once per organism: its samplesheet, analysisConfig and
  STF agree with each other and with the samples tagged for that organism.
- `renderArtifacts(proposalDir, organism)` reads that organism's directory.
  `sampleAnnotations.json` in each delivery is the filtered annotations.

### profileSetName

With two or more organisms, `analysisConfig.xml` uses
`<proposedOrganismAbbrev> <profileSetName>`, where `profileSetName` is the
curator's value or the default `${name} RNA-Seq`. The curated artifacts are
fixed in Phase 1, before settlement, so the prefix is the proposed
abbreviation; it only has to keep the organisms' profile sets apart.
Single-organism proposals keep the plain name.

## Presenter

### presenter.json

```json
{
  "displayName": "...", "shortDisplayName": "...", "description": "...",
  "injectorProps": { "graphXAxisSamplesDescription": "...", "isDESeq": "true" },
  "organisms": {
    "hsapREF": { "injectorProps": { "switchStrandsProfiles": "true", "isDESeq": "false" } }
  }
}
```

- Top-level `injectorProps` apply to every organism. Each organism's
  injector is `injectorDefaults`, then top-level `injectorProps`, then
  `organisms.<abbrev>.injectorProps`.
- `organisms` is optional. Its keys must be manifest organisms.
- `requiredInjectorProps` are checked on each organism's merged props.

### Rendering

`renderPresenter(proposalDir, { build })` is called once per proposal.

- One organism: unchanged.
  `<datasetPresenter name="${organism}_${name}_rnaSeq_RSRC" projectName="...">`
  with one injector.
- Two or more organisms:
  `<datasetPresenter name="${name}_rnaSeq_RSRC" datasetNamePattern="%_${name}_rnaSeq_RSRC">`,
  no `projectName` on the presenter, and per organism
  `<templateInjector projectName="<organism's project>" datasourceName="${organism}_${name}_rnaSeq_RSRC" ...>`
  in manifest order.

`presenterNames` returns the one name. Load inserts the one presenter into
the home project's presenter file and refuses a name already present there.

## Dataset XML

Unchanged in shape: one `<dataset>` entry per organism, rendered from the
shared `dataset.json`, written to `<organism's project>/<organism>.xml`. The
name-taken check runs against each organism's own file.

## Error handling

All refusals happen in Phase 1 (`write-proposal`) and again at load, before
anything is written:

- an organism found in no project on the rebuild branch or in pending genome
  claims;
- the home organism's project differs from `--project`;
- a multi-organism sample with no `organisms` tag, or a tag naming a
  non-manifest organism;
- an organism no sample is tagged for;
- `presenter.json` `organisms` keys that are not manifest organisms;
- per-organism curated artifacts that disagree (`checkCurated`);
- a name that `datasetNamePattern` would make collide across organisms: a
  multi-organism name any organism file or other proposal on master already
  has, or a single-organism name a multi-organism presenter or proposal uses.

## Testing

- Manifest: v4 validation, v3 refusal, per-organism project resolution,
  home project mismatch.
- Cross-check: a host organism in HostDB passes in a PlasmoDB-home proposal.
- Annotations: each membership case (a, b, c); missing tag, unknown tag,
  organism with no samples.
- Artifacts: per-organism filtering, profileSetName prefix, `checkCurated`
  per organism, hand-edit protection on nested paths.
- Presenter: single-organism output byte-identical to today; Lee_Gambian
  shaped output for pfal3D7 + hsapREF with per-organism prop overrides.
- Load: one presenter into the home file, dataset entries into both
  projects' organism files, settled abbreviations in rendered names.

## Out of scope

- Per-organism `dataset.json` (strandedness, source, props). Add when a case
  needs it.
- Suffixed proposal ids for splitting one accession into separate proposals
  with separate tickets.
- Migrating existing v3 proposals other than by re-running
  `write-proposal.js`.
