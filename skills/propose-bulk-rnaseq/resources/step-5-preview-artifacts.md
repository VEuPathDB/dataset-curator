# Step 5: Preview the Loading Artifacts

## Who delivers what

The loading artifacts are **not** delivered in Phase 1. When the data loading
team runs `load-proposals` on `rebuild<NN>`, it generates them from the
proposal and tells them where to copy them. Copying files to the server and
checking the data there is their step alone.

This step lets the curator see now what the loaders will get, while the
dataset is still fresh in mind.

## Command

```bash
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<BIOPROJECT>
```

It writes, under
`.curation/delivery/<Project>/<organismAbbrev>/rnaSeq/<name>/<version>/final/`:

| File | Built from |
|---|---|
| `analysisConfig.xml` | `profileSetName` and samples in the sample annotations; `isStrandSpecific` from `dataset.json` |
| `samplesheet.csv` | one row per run; `fastq_2` repeats the run accession when `hasPairedEnds` is true |
| `sampleAnnotations.json` | the curated sample annotations, as committed |
| `sample-annotations-stf/<presenterName>/entity-sample.{tsv,yaml}` | the sample annotations in STF form |

and prints the hand-off: the local directory, the
`@@manualDeliveryDir@@/...` target taken from the class's `<unpack>` line in
`classes.xml`, and the read source.

`.curation/` is excluded from git, so nothing here is committed. The same files
are regenerated in Phase 2 from what the proposal holds, so do not edit them;
fix the sample annotations or the overrides and re-run Step 4.

## What to check with the curator

- Sample labels in `analysisConfig.xml` read well on a graph axis.
- Replicates share a label; distinct conditions do not.
- The samplesheet has every run, and single/paired matches the library layout.
- The target path shows the intended `name` and `version`.

## Limits

Only SRA read sources can produce a samplesheet today. A proposal whose
`dataset.source` is `server` or `url` stops here with a message; its reads need
per-sample file paths, which proposals do not carry yet.
