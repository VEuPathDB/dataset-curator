# Build 72 RNA-seq run log

Orchestrator-level record of each dataset processed. Concerns raised by subagents are
recorded verbatim in `rnaseq-caveats.txt`; this file is the per-dataset summary.

Started: (not yet). 28 datasets to process (none excluded — see `rnaseq-skipped.txt`).
Subagent model: Sonnet.

| # | datasetName | Status | Samples | Strandedness | Concerns |
|---|-------------|--------|---------|--------------|----------|
| 1 | psojP6497_Dong_2018_rnaSeq_RSRC | TODO | | | |
| 2 | mlar98AG31_INRA_2021_rnaSeq_RSRC | TODO | | | |
| 3 | cneoKN99_gish_2016_rnaSeq_RSRC | TODO | | | |
| 4 | cglaCBS138_Rai_2023_rnaSeq_RSRC | TODO | | | |
| 5 | osatNipponbare_Os_Po_Bidzinski_2016_rnaSeq_RSRC | TODO | | | |
| 6 | osatNipponbare_Os_Mo_Glutamine_2016_rnaSeq_RSRC | TODO | | | |
| 7 | pinfT30-4_Liao_2020_rnaSeq_RSRC | TODO | | | |
| 8 | pgraCRL75-36-700-3_SharmaPoudel_2019_rnaSeq_RSRC | TODO | | | |
| 9 | umay521_McCotter_2023_rnaSeq_RSRC | TODO | | | |
| 10 | umay521_Damoo_2024_rnaSeq_RSRC | TODO | | | |
| 11 | bcinB05-10_Silva_2023_rnaSeq_RSRC | TODO | | | |
| 12 | bcinB05-10_Naets_2022_rnaSeq_RSRC | TODO | | | |
| 13 | bcinB05-10_Vela-Corcia_2024_rnaSeq_RSRC | TODO | | | |
| 14 | bsorND90Pr_Bsorokiniana_McDonald_2018_rnaSeq_RSRC | TODO | | | |
| 15 | aaltSRC1lrK2f_aalt_Tang_2025_rnaSeq_RSRC | TODO | | | |
| 16 | afumA1160_Weaver_2026_rnaSeq_RSRC | TODO | | | |
| 17 | afumA1163_Weaver_2026_rnaSeq_RSRC | TODO | | | |
| 18 | bgraTritici96224_Spanu_2010_rnaSeq_RSRC | TODO | | | |
| 19 | bgraTritici96224_Pham_2019_rnaSeq_RSRC | TODO | | | |
| 20 | bgraTritici96224_Gong_2023_rnaSeq_RSRC | TODO | | | |
| 21 | fgraPH-1_Gu_2026_rnaSeq_RSRC | TODO | | | |
| 22 | foxyf.conglutinansFo5176_Ayukawa_2021_rnaSeq_RSRC | TODO | | | |
| 23 | ztriIPO323_UoE_2024_rnaSeq_RSRC | TODO | | | |
| 24 | ztriIPO323_Fagundes_2026_rnaSeq_RSRC | TODO | | | |
| 25 | pfal3D7_Gujarati_2026_rnaSeq_RSRC | TODO | | | |
| 26 | smanPuertoRico_Buddenborg_2023_rnaSeq_RSRC | TODO | | | |
| 27 | pfal3D7_Zanghi_2025_rnaSeq_RSRC | TODO | | | |
| 28 | celeBristolN2_Lazetic_2021_rnaSeq_RSRC | TODO | | | |

## Open workflow issues

- **Row 5 (`osatNipponbare_Os_Po_Bidzinski_2016`) has no BioProject or PMID.** Curator decision 2026-10-21: annotate from `analysisConfig.xml` labels + `samplesheet.csv` alone (skip Steps 3 and 4).
- **After Build 72:** port the placeholder scrubbing (N/A / `unit: none`) from this branch's `sample-annotations-to-stf.js` into master's `lib/stf.js` (see memory `port-placeholder-scrubbing-to-master`).
