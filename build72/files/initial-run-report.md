All 28 rows have now been through the loop. 24 are done and 4 are held, so the run isn't complete. Nothing is committed since the setup commit: the 24 outputs, `rnaseq-done.txt`, `rnaseq-caveats.txt` (47 lines) and `run-log.md` are all uncommitted.

## The 4 held rows
| Row | Dataset | Problem |
|---|---|---|
| 1 | `psojP6497_Dong_2018` | The TSV path points at another dataset's files (the *B. cinerea* data from row 13). The real data is in `…/psojP6497/rnaSeq/dong_psojP6497_2018/2018-10-31/final`. |
| 10 | `umay521_Damoo_2024` | Same problem: the TSV path holds row 11's *B. cinerea* config. The real data is in `…/umay521/rnaSeq/umaydis_Damoo_2024/2024-11-06/final`. |
| 24 | `ztriIPO323_Fagundes_2026` | The delivery includes 3 ChIP-seq samples and a culture sample, and the dpi labels are scrambled. It needs a corrected delivery. |
| 25 | `pfal3D7_Gujarati_2026` | The "Complicated" and "Uncomplicated" labels are swapped against ENA. |

- Rows 1 and 10 also look like renames of datasets curated in Builds 70 and 71 (`psojP6497_dong_psojP6497_2018_…` and `umay521_umaydis_Damoo_2024_…`). Should I re-curate them under the new names from the corrected paths, or reuse or rename the old outputs?
- Rows 24 and 25 can't proceed until the data team redelivers or says which side is right.

## Other things for you to check
- **Wrong PMIDs in the TSV:** row 6 (28280342 is an OCD paper) and row 17 (37868543 is a case report). The likely fix for row 17 is 41673015.
- **Pooled replicates:** rows 15 and 22 follow the delivered config, which lists one sample per condition. The 3 replicate runs per condition are pooled into one row. Per-replicate rows would need a redelivery.
- **Unconfirmed organism or strain:**
  - Rows 18 and 19 are *B. graminis* f.sp. *hordei* data under a *tritici* dataset name.
  - Rows 7 and 14 name a different strain than the data shows.
- **A guessed value:** row 4 assumes 30 °C for the stress samples.
- **Constant factors:** rows 9, 11 and 21 each have a factor that's the same for every sample. Say if you want those dropped.
- **Odd run mapping:** row 27's samplesheet lists a second run whose SRA record belongs to the neighbouring BioSample.

All of this, with detail, is in `build72/files/run-log.md` and `rnaseq-caveats.txt`.

## Next
1. Tell me what to do with rows 1, 10, 24 and 25. After that I can run the four held rows, or wait for redelivery.
2. I'd run the DESeq-suitability report and the memory reminder about porting the placeholder scrubbing to master once the held rows are settled.
3. Do you want me to commit the 24 finished outputs and logs to `rel72-catch-up` now, so the progress is safe?
