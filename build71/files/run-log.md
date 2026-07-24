# Build 71 RNA-seq run log

Orchestrator-level record of each dataset processed. Concerns raised by subagents are
recorded verbatim in `rnaseq-caveats.txt`; this file is the per-dataset summary.

Started: 2026-07-23. 32 datasets to process (2 excluded — see `rnaseq-skipped.txt`).
Subagent model: Sonnet.

| # | datasetName | Status | Samples | Strandedness | Concerns |
|---|-------------|--------|---------|--------------|----------|
| 1 | plinCAN1_plinCAN1_Clairet_2024_rnaSeq_RSRC | DONE (redone verbatim) | 16 | stranded | 1 — `transformant_line` factor judgement call, **verified CONFIRMED** vs GEO GSE236510; labels now verbatim |
| 2 | pcacP414_pcacP414_Yangzhou_2025_rnaSeq_RSRC | DONE | 3 | unstranded | none (no PMID; annotations from analysisConfig/samplesheet, consistent with SRA) |
| 3 | pinfT30-4_Shu_pinfT30-4_2024_rnaSeq_RSRC | DONE (redone verbatim) | 4 | stranded | none (no PMID; labels now verbatim `2dpi`/`3dpi`; `timePostInfection` factor) |
| 4 | rdelRA99-880_Sephton-Clark_RdelRA99_2018_rnaSeq_RSRC | DONE (redone verbatim) | 30 | unstranded | 1 — 2 SRR runs per sample (same BioSample, both paired runs); both included; labels now verbatim `0hr`…`24hr` |
| 5 | umay521_umaydis_Damoo_2024_rnaSeq_RSRC | DONE | 12 | unstranded | 1 — per curator direction, `label` kept verbatim from analysisConfig (not decoded); decoded meaning split into `medium`+`supplement` factors; semantics confirmed via GEO GSE265973 |
| 6 | umay521_Malesevic_umay521_2022_rnaSeq_RSRC | DONE | 3 | unstranded | 1 (informational) — only 3 samples, one run per condition, no biological replicates; `treatment` factor decoded via PMID 36135682 (RUS = regrowth-under-starvation) |
| 7 | calbSC5314_Hollomon_Calb_2016_rnaSeq_RSRC | DONE | 8 | stranded | 4 — (a) samplesheet has SRX not SRR, resolved each to 4 SRRs; (b) profileSetName says "temperature stress" but study (PMID 27921082) is pH/cAMP — used verbatim; (c) **before-pipe labels include `rep1`/`rep2` — upstream analysisConfig error, reported to colleague; transcribed verbatim per spec**; (d) pH factor inferred integer/continuous, really 2-level categorical |
| 8 | foxy4287_foxy4287_Kim_2025_rnaSeq_RSRC | DONE | 18 | stranded | none (shared PRJNA1173228, own subset; bioRxiv preprint confirmed stage/genotype) |
| 9 | foxy4287_foxy_Restrepo_2016_rnaSeq_RSRC | DONE | 3 | unstranded | 1 — sampleIds are BioSamples w/ 3 technical-rep runs each (3 conditions: AmphoB/Posaconazole/DMSO); samplesheet cols `sample`/`fastq_1` variant, mapping identical (shared PRJNA323849) |
| 10 | foxy4287_foxy4287_Palos-Fernandez_2024_rnaSeq_RSRC | DONE | 24 | unstranded | 1 — factor-design judgement call: condition split into genotype/sample_source/copper_availability/time_in_culture/days_post_infection; mixed units, blanks where inapplicable |
| 11 | mory70-15_Magna_WGCNA_Yan_2022_rnaSeq_RSRC | DONE | 72 | stranded | 2 — two profileSetName props (used `RnaSeqAnalysisEbi` per convention); 1 extra ENA run (ERR5928178, low reads) not in samplesheet, correctly excluded (PRJEB/ERR) |
| 12 | ncraOR74A_Leader_ncraOR74A_2013_rnaSeq_RSRC | DONE | 2 | unstranded | none (WT vs Δpp-1 conidia at 5h; confirmed PMID 24037267) |
| 13 | ncraOR74A_ncraOR74A_Belden_2019_rnaSeq_RSRC | DONE | 12 | unstranded | none (WT/Δset-1/Δdim-5 × dark/light-pulse; 2 runs per sample; confirmed PMID 31068130) |
| 14 | aflaNRRL3357_aflaNRRL3357_Rokas_2026_rnaSeq_RSRC | **FAILED** | 0 | n/a | **BLOCKING — delivery is WGS/SNP not RNA-seq; bioprojectAccession also mismatched. Needs curator fix (Redmine #56769).** Not marked done. |
| 15 | sscl1980UF-70_sscl1980UF-70_Kusch_2022_PAIRED_rnaSeq_RSRC | DONE | 24 | unstranded | none (shared PRJNA670487, own subset; 5 factors: growth_condition/host_plant/lesion_zone/chemical_treatment/camalexin_concentration) |
| 16 | sscl1980UF-70_sscl1980UF-70_Kusch_2022_SINGLE_rnaSeq_RSRC | DONE | 27 | unstranded | 1 — path fix applied (date dir); factor values periphery/center decoded via SRA FRT/NEC + abstract; sampling_zone=n/a for PDB_liquid (shared PRJNA670487) |
| 17 | anidFGSCA4_anidFGSCA4_Kim_2025_rnaSeq_RSRC | DONE | 12 | stranded | none (shared PRJNA1173228, own subset; 4-stage germination, bioRxiv-confirmed) |
| 18 | afumAf293_afumAf293_Kim_2025_rnaSeq_RSRC | DONE | 12 | stranded | none (shared PRJNA1173228, AF_ subset; 4-stage germination, bioRxiv-confirmed) |
| 19 | ptri1-1BBBDRace1_Sucher_Ptriticina_2018_rnaSeq_RSRC | DONE | 6 | unstranded | none (shared PRJNA393407, P. triticina subset; Lr34 resistant vs susceptible wheat host) |
| 20 | mresKCTC27527_Park_mresKCTC27527_2020_rnaSeq_RSRC | DONE | 6 | stranded | none (2×3 strain × treatment; ketoconazole resistance in Malassezia restricta) |
| 21 | vdahJR2_Vd_Scholz_2018_rnaSeq_RSRC | DONE | 6 | unstranded | 1 — **TSV PMID 36747219 is WRONG** (resolves to a Z. tritici paper, not this Vd/Arabidopsis study); processed from analysisConfig+SRA only. Curator may want to correct the TSV PMID. |
| 22 | ttonCBS112818_Xiao_Tspp_2023_rnaSeq_RSRC | DONE | 5 | unstranded | 1 — organism prefix ttonCBS112818 (T. tonsurans) but SRA runs are T. interdigitale; cross-species mapping to nearest reference. No factors (single condition, 5 reps). Shared PRJNA819275 (host-pathogen pair). Study-purpose check: dual-RNA-seq DE study (not annotation); possible monoculture controls in BioProject — curator to confirm (see caveats). |
| 23 | fsolFSSC5MPISDFRAT0091_fsol_Restrepo_2016_rnaSeq_RSRC | DONE | 3 | unstranded | none (shared PRJNA323849, F. solani subset; 3 conditions AmphoB/Posaconazole/DMSO, 3 technical-rep runs each) |
| 24 | bgrasphordeiiRACE1_Sucher_Bhordei_2018_rnaSeq_RSRC | DONE | 12 | unstranded | none (shared PRJNA393407, B. hordei subset; host_genotype × timepoint on Lr34 barley) |
| 25 | mmusC57BL6J_mmusC57BL6J_Guirao-Abad_2026_rnaSeq_RSRC | DONE | 8 | unstranded | none (HostDB; mouse pulmonary fibroblast activation in A. fumigatus infection; cellLineage × treatment) |
| 26 | mmusC57BL6J_de-Souza-Silva_mmusC57BL6J_2020_rnaSeq_RSRC | DONE | 12 | unstranded | 1 — prefix mmusC57BL6J is reference build only; actual strains A/J & B10.A (dendritic cells + P. brasiliensis; strain × infection) |
| 27 | hsapREF_Xiao_Tspp_2023_rnaSeq_RSRC | DONE | 12 | unstranded | none (HostDB; host arm of PRJNA819275 dual-RNA-seq — HAS untreated control vs co-culture w/ 3 Trichophyton spp; `pathogen` factor. NB the FungiDB fungal arm row 22 lacks its monoculture control) |
| 28 | mmusC57BL6J_mmusC57BL6J_Vanpala_2020_rnaSeq_RSRC | DONE | 12 | unstranded | none (HostDB; alveolar macrophages + C. neoformans; FM±=Flt3 fate-mapping decoded via PMID 32769172; factors infection/ontogenicOrigin/cxcl2Status) |
| 29 | mmusC57BL6J_mmusC57BL6J_Wang_2020_rnaSeq_RSRC | DONE | 18 | stranded | none (HostDB; BMDM + C. auris; stimulus × time) |
| 30 | sscaArlian_Korhonen_stages_2020_rnaSeq_RSRC | DONE | 2 | unstranded | none (VectorBase; S. scabiei suis life stages eggs vs mixed; life_stage factor; confirmed PMID 33001992) |
| 31 | wsmiHCP4_Voshall_sex_brain_Wyeo_2020_rnaSeq_RSRC | DONE | 6 | stranded | none (VectorBase; Wyeomyia smithii sex-specific brain; sex factor) |
| 32 | sscaArlian_Xu_stages_sexes_2022_rnaSeq_RSRC | DONE | 4 | unstranded | 1 — labels are opaque submitter codes (adults/X4-6/X4-2/Mix1); PMID 36134513 is a genomics paper that doesn't decode them, so kept verbatim with generic `sample_group` factor. Curator may want better stage/sex labels. |

## Open workflow issues

- **Row 14 `aflaNRRL3357_aflaNRRL3357_Rokas_2026` — FAILED, needs curator fix (2026-07-24).** The
  manual delivery at the TSV `manualDeliveryPath` contains a **WGS/SNP** analysis
  (`analysisConfig.xml` profileSetName = "SNPs on WGS of clinical isolates of Aspergillus flavus";
  samplesheet = 82 isolate genomes, matching WGS study PMID 40817095, Hatmaker/Rokas 2025 Nat
  Commun), **not RNA-seq**. Meanwhile the TSV `bioprojectAccession` PRJNA1257291 resolves to an
  unrelated *A. fumigatus* prrA-overexpression RNA-seq study (SRR33385814–819), disjoint from the
  samplesheet. So both the delivery path AND the bioproject look wrong for an RNA-seq row.
  **Action:** curator to verify the correct RNA-seq `manualDeliveryPath`/`bioprojectAccession` for
  this dataset (Redmine #56769), or confirm it doesn't belong in the RNA-seq batch. Not appended to
  `rnaseq-done.txt`; rsynced inputs left at
  `build71/manual_delivery_tmp/aflaNRRL3357_aflaNRRL3357_Rokas_2026_rnaSeq_RSRC/final/`.


- **Label house-style corrected 2026-07-24 (rows 1–4 need revisit).** Build 71's Critical
  reminders originally told subagents to *decode* abbreviations into `label` (the `ΔLmPf2` example),
  contradicting Build 70's primary rule (transcribe the before-pipe text verbatim). Per curator
  decision the docs now say: **`label` = before-pipe text VERBATIM; decoded meaning goes in
  `factors`**. Rows 5+ follow this. Revisit status of rows 1–4 (after curator review 2026-07-24):
  - Row 1 (plinCAN1): **redone 2026-07-24 under verbatim-label spec** (factors genotype/overexpression/transformant_line; transformant_line re-verified vs GEO GSE236510).
  - Row 2 (pcacP414): **curator confirmed good — no redo needed.**
  - Row 3 (pinfT30-4): **redone 2026-07-24 under verbatim-label spec** (labels now `2dpi`/`3dpi`).
  - Row 4 (rdelRA99-880): **redone 2026-07-24 under verbatim-label spec** (labels now `0hr`…`24hr`).
  Rows 5 (umay521 Damoo) and 6 (umay521 Malesevic) already conform; row 7 (calbSC5314) transcribed
  verbatim (upstream analysisConfig label issue reported to colleague, not a style problem).


- **PubMed MCP (row 1) — RESOLVED 2026-07-23.** Cause: the curator had not completed MCP auth when row 1 ran; the subagent correctly fell back to `WebFetch` and the output was fine. PubMed + bioRxiv MCP are now connected in the orchestrator session. It's still unconfirmed whether MCP propagates to every subagent, so Step 4 and the prompt template now say "try MCP first, fall back to WebFetch". No further action needed.
