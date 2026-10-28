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
node scripts/render-proposal.js --artifacts .curation/delivery Proposals/<ACCESSION>
```

It first checks that the curated artifacts agree, then copies them under
`.curation/delivery/<Project>/<organism>/SNP/<name>/<version>/final/`:

| File | Copied from |
|---|---|
| `samplesheet.csv` | `curated/<abbrev>/samplesheet.csv`: one row per run; each SRA run appears once with `fastq_2` empty (downstream expands it to its paired files) |
| `sampleAnnotations.json` | the curated sample annotations |

and prints a preview note: the local directory, the
`@@manualDeliveryDir@@/...` target taken from the class's `<unpack>` line in
`classes.xml`, and the read source. The STF files
(`curated/<abbrev>/entity-sample.{tsv,yaml}`) are not part of the preview; they
go to the STF corpus at preprocessing.

`.curation/` is excluded from git, so nothing here is committed. Do not edit
these copies; fix the sample annotations or the overrides and re-run Step 4.

`.curation/delivery` is shared by every proposal previewed in this checkout. A
preview overwrites only this proposal's paths; **never delete the directory**.

## What to check with the curator

- One sample per BioSample; the samplesheet has every run the curator kept,
  and none they dropped.
- The samplesheet sample names are the STF sample ids.
- Labels name the isolates clearly.
- The target path shows the intended `name` and `version`.
