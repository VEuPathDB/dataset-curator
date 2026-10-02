# Step 5: Preview the Loading Artifacts

## Who delivers what

The loading artifacts are **not** delivered in Phase 1. When the data loading
team runs `load-proposals` on `rebuild<NN>`, it lays them out from the proposal
and tells them where to copy them. Copying files to the server and checking the
data there is their step alone.

This step lets the curator see now what the loaders will get, while the
dataset is still fresh in mind.

## Command

```bash
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<BIOPROJECT>
```

It first checks that the curated artifacts agree, then copies them. There is
one delivery directory per organism, under
`.curation/delivery/<Project>/<organism>/rnaSeq/<name>/<version>/final/`:

| File | Copied from |
|---|---|
| `analysisConfig.xml` | `curated/analysisConfig.xml` |
| `samplesheet.csv` | `curated/samplesheet.csv`: one row per run or files entry; each SRA run appears once with `fastq_2` empty (downstream expands it to its paired files) |
| `sampleAnnotations.json` | the curated sample annotations, as committed |
| `sample-annotations-stf/<organism presenter name>/entity-sample.{tsv,yaml}` | `curated/entity-sample.{tsv,yaml}`, in each organism's own directory |

and prints the hand-off: the local directory, the
`@@manualDeliveryDir@@/...` target taken from the class's `<unpack>` line in
`classes.xml`, and the read source.

`.curation/` is excluded from git, so nothing here is committed. Do not edit
these copies; fix the sample annotations or the overrides and re-run Step 4.

## What to check with the curator

- Sample labels in `analysisConfig.xml` read well on a graph axis.
- Replicates share a label; distinct conditions do not.
- The samplesheet has every run or file, and single/paired matches the library layout.
- The target path shows the intended `name` and `version`.
