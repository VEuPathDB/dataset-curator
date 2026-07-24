All checks pass. The Build 71 run is complete. Here's the summary:

## Build 71 RNA-seq STF curation — run complete

**Processed: 31 of 32 datasets → DONE** (all have `entity-sample.tsv` + `.yaml` in `build71/outputs/`)
**1 failed** (blocking data problem) · **2 excluded** by design (scRNA + miRNA)

**Bookkeeping verified:** the 31 successes are all in `rnaseq-done.txt`; the failed row and the 2 excluded rows are correctly absent; no output dir exists for the failed row.

### Mid-run correction (rows 1–7 era)
The workflow's original "decode abbreviations into `label`" guidance conflicted with Build 70's "transcribe verbatim" rule. Per your decision I fixed the docs (`label` = verbatim, meaning → `factors`), and **re-ran rows 1, 3, 4** under the corrected spec (row 2 you confirmed good; rows 5–7 already conformed). Also fixed the docs for multi-run-per-sample handling and added your jq preference.

### Items needing curator follow-up (all in `run-log.md` "Open workflow issues" + `rnaseq-caveats.txt`)

| Row | Dataset | Issue |
|---|---|---|
| 14 | `aflaNRRL3357…Rokas_2026` | **FAILED** — delivery is WGS/SNP not RNA-seq, and `bioprojectAccession` mismatched. Needs TSV fix (Redmine #56769). |
| 21 | `vdahJR2_Vd_Scholz_2018` | TSV **PMID 36747219 is wrong** (a *Z. tritici* paper). Processed from analysisConfig+SRA. |
| 22 | `ttonCBS112818_Xiao_Tspp_2023` | Fungal arm orphaned for DE (only co-culture, no monoculture control); host arm (row 27) has the control contrast. Curators looking for other samples. |
| 7 | `calbSC5314_Hollomon_2016` | Upstream `analysisConfig.xml` has replicate numbers baked into labels (you're reporting to your colleague); profileSetName also says "temperature" but study is pH. |
| 32 | `sscaArlian_Xu_2022` | Opaque submitter label codes couldn't be decoded (PMID is a genomics paper); kept verbatim, generic `sample_group` factor. |

A handful of others logged benign notes (organism-prefix-as-reference-build, technical-replicate collapsing, PRJEB/ERR handling) — all in the caveats file.

Everything is content-only — **no git operations were performed**; branches/commits/PRs are yours to make. Want me to do anything else, e.g. spot-check any specific STF output, or draft better stage/sex labels for row 32?
