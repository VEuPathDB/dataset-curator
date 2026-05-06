# Build 70 RNA-seq Remaining TODO (as of 2026-05-06, updated after session 2)

10 datasets remain to process from `redmine-rnaseq.json`.
All other qualifying entries are already in `rnaseq-done.txt`.

## Workflow reminder

Per `build70/CLAUDE.md`: spawn one subagent per entry sequentially, running Steps 1–7.
The subagent prompt should include the `presenters_commit` URL and `manual_delivery` path.

## Completed in session 2 (2026-05-06)

| datasetName | status |
|-------------|--------|
| csuiWienI_RNASeq_csuiWienI_rnaSeq_RSRC | ✅ done |
| tconIL3000_Pereira_SL_Sequestration_rnaSeq_RSRC | ✅ done |
| plutPb01_Paracoccidioides_Argentilactone_Transcriptome_rnaSeq_RSRC | ✅ done |
| bmayC4_ChAP1_FerulatResponse_Cheterostr_rnaSeq_RSRC | ✅ done |
| mory70-15_Os_Po_Bidzinski_2016_rnaSeq_RSRC | ✅ done |

## Remaining entries (5 left)

| # | datasetName | presenters_commit | manual_delivery |
|---|-------------|-------------------|-----------------|
| 1 | mory70-15_HH_2017_Magnaporthe_NIS_rnaSeq_RSRC | https://github.com/VEuPathDB/ApiCommonPresenters/commit/40d7e886ad2507827cd13d12c82395268b7ce2c9 | /eupath/data/EuPathDB/manualDelivery/FungiDB/mory70-15/rnaSeq/HH_2017_Magnaporthe_NIS/2017-02-01/final |
| 2 | cneoH99_Pdr802_Titan_Regulation_rnaSeq_RSRC | https://github.com/VEuPathDB/ApiCommonPresenters/commit/2271b3c4fec73d42e93d639c038414aad5ba2722 | /eupath/data/EuPathDB/manualDelivery/FungiDB/cneoH99/rnaSeq/Pdr802_Titan_Regulation/2021-03-09/final |
| 3 | calbSC5314_Temperature_Dependent_Fitness_rnaSeq_RSRC | https://github.com/VEuPathDB/ApiCommonPresenters/commit/f442069509e58b4c3f60fb4955113c8d9ec3e05a | /eupath/data/EuPathDB/manualDelivery/FungiDB/calbSC5314/rnaSeq/Temperature_Dependent_Fitness/2025-10-23/final |
| 4 | ztriIPO323_Multiple_Growth_Media_rnaSeq_RSRC | https://github.com/VEuPathDB/ApiCommonPresenters/commit/380ccb16a29b217270c4e88d316039cea4a55341 | /eupath/data/EuPathDB/manualDelivery/FungiDB/ztriIPO323/rnaSeq/Multiple_Growth_Media/2023-07-04/final |
| 5 | asteIndian_Pathak_thermal_variation_transcriptome_rnaSeq_RSRC | https://github.com/VEuPathDB/ApiCommonPresenters/commit/6f971f6a484f056028fb62b950c9f90ec72badf2 | /eupath/data/EuPathDB/manualDelivery/VectorBase/asteIndian/rnaSeq/Pathak_thermal_variation_transcriptome/2024-05-24/final |

## Notes

- All entries in `redmine-rnaseq.json` with `presenters_commit` + `manual_delivery` + `/rnaSeq/` in path and no `error`/`skip` field were analysed.
- 30 qualifying entries total: 20 already in `rnaseq-done.txt`, 10 remain above.
- The 4 agamPEST entries (tickets 54188–54192) are done under names with `_ebi_` suffix — parse-github-commit.js returns a different name for these commits because the commits add multiple datasets; the JSON's pre-filled `dataset_name` is authoritative for those tickets.
- Ticket 56173 JSON has `dataset_name: "15_Os_Po_Bidzinski_2016_rnaSeq_RSRC"` (truncated) — the parse script correctly returns `mory70-15_Os_Po_Bidzinski_2016_rnaSeq_RSRC`.
