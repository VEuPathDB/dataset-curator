# DESeq-suitability test — Build 71 STF outputs

A dataset is **DESeq-suitable** only if its samples can be partitioned, by the
`label` field, into **two non-empty groups each with at least two samples**
(whole labels assigned to one side or the other). Equivalent to: some subset of
the per-label sample counts sums to a value between 2 and N−2 (N = total samples).

Datasets with ≥ 10 samples are almost always suitable and weren't the
point of the check, but are included since the test is scripted.

Source: `build71/outputs/<dataset>/entity-sample.tsv`

- Datasets tested: **31**
- DESeq-suitable: **24**
- NOT suitable: **7**

## DESeq-suitable

```
afumAf293_afumAf293_Kim_2025_rnaSeq_RSRC
anidFGSCA4_anidFGSCA4_Kim_2025_rnaSeq_RSRC
bgrasphordeiiRACE1_Sucher_Bhordei_2018_rnaSeq_RSRC
calbSC5314_Hollomon_Calb_2016_rnaSeq_RSRC
foxy4287_foxy4287_Kim_2025_rnaSeq_RSRC
foxy4287_foxy4287_Palos-Fernandez_2024_rnaSeq_RSRC
hsapREF_Xiao_Tspp_2023_rnaSeq_RSRC
mmusC57BL6J_de-Souza-Silva_mmusC57BL6J_2020_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Guirao-Abad_2026_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Vanpala_2020_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Wang_2020_rnaSeq_RSRC
mory70-15_Magna_WGCNA_Yan_2022_rnaSeq_RSRC
mresKCTC27527_Park_mresKCTC27527_2020_rnaSeq_RSRC
ncraOR74A_ncraOR74A_Belden_2019_rnaSeq_RSRC
pinfT30-4_Shu_pinfT30-4_2024_rnaSeq_RSRC
plinCAN1_plinCAN1_Clairet_2024_rnaSeq_RSRC
ptri1-1BBBDRace1_Sucher_Ptriticina_2018_rnaSeq_RSRC
rdelRA99-880_Sephton-Clark_RdelRA99_2018_rnaSeq_RSRC
sscaArlian_Xu_stages_sexes_2022_rnaSeq_RSRC
sscl1980UF-70_sscl1980UF-70_Kusch_2022_PAIRED_rnaSeq_RSRC
sscl1980UF-70_sscl1980UF-70_Kusch_2022_SINGLE_rnaSeq_RSRC
umay521_umaydis_Damoo_2024_rnaSeq_RSRC
vdahJR2_Vd_Scholz_2018_rnaSeq_RSRC
wsmiHCP4_Voshall_sex_brain_Wyeo_2020_rnaSeq_RSRC
```

## NOT DESeq-suitable

```
foxy4287_foxy_Restrepo_2016_rnaSeq_RSRC
fsolFSSC5MPISDFRAT0091_fsol_Restrepo_2016_rnaSeq_RSRC
ncraOR74A_Leader_ncraOR74A_2013_rnaSeq_RSRC
pcacP414_pcacP414_Yangzhou_2025_rnaSeq_RSRC
sscaArlian_Korhonen_stages_2020_rnaSeq_RSRC
ttonCBS112818_Xiao_Tspp_2023_rnaSeq_RSRC
umay521_Malesevic_umay521_2022_rnaSeq_RSRC
```

## Suitable, small (< 10 samples) — the ones the check actually mattered for

```
calbSC5314_Hollomon_Calb_2016_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Guirao-Abad_2026_rnaSeq_RSRC
mresKCTC27527_Park_mresKCTC27527_2020_rnaSeq_RSRC
pinfT30-4_Shu_pinfT30-4_2024_rnaSeq_RSRC
ptri1-1BBBDRace1_Sucher_Ptriticina_2018_rnaSeq_RSRC
sscaArlian_Xu_stages_sexes_2022_rnaSeq_RSRC
vdahJR2_Vd_Scholz_2018_rnaSeq_RSRC
wsmiHCP4_Voshall_sex_brain_Wyeo_2020_rnaSeq_RSRC
```

## Suitable, large (≥ 10 samples) — trivially expected

```
afumAf293_afumAf293_Kim_2025_rnaSeq_RSRC
anidFGSCA4_anidFGSCA4_Kim_2025_rnaSeq_RSRC
bgrasphordeiiRACE1_Sucher_Bhordei_2018_rnaSeq_RSRC
foxy4287_foxy4287_Kim_2025_rnaSeq_RSRC
foxy4287_foxy4287_Palos-Fernandez_2024_rnaSeq_RSRC
hsapREF_Xiao_Tspp_2023_rnaSeq_RSRC
mmusC57BL6J_de-Souza-Silva_mmusC57BL6J_2020_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Vanpala_2020_rnaSeq_RSRC
mmusC57BL6J_mmusC57BL6J_Wang_2020_rnaSeq_RSRC
mory70-15_Magna_WGCNA_Yan_2022_rnaSeq_RSRC
ncraOR74A_ncraOR74A_Belden_2019_rnaSeq_RSRC
plinCAN1_plinCAN1_Clairet_2024_rnaSeq_RSRC
rdelRA99-880_Sephton-Clark_RdelRA99_2018_rnaSeq_RSRC
sscl1980UF-70_sscl1980UF-70_Kusch_2022_PAIRED_rnaSeq_RSRC
sscl1980UF-70_sscl1980UF-70_Kusch_2022_SINGLE_rnaSeq_RSRC
umay521_umaydis_Damoo_2024_rnaSeq_RSRC
```

## Details

| Dataset | N | Labels | Composition | Suitable | Example split / reason |
|---|---|---|---|---|---|
| afumAf293_afumAf293_Kim_2025_rnaSeq_RSRC | 12 | 4 | Germinated conidia_STAGE4×3, Germinated conidia_STAGE3×3, Germinated conidia_STAGE2×3, Conidia_STAGE1×3 | ✅ | {Germinated conidia_STAGE4} (3) vs {Germinated conidia_STAGE3, Germinated conidia_STAGE2, Conidia_STAGE1} (9) |
| anidFGSCA4_anidFGSCA4_Kim_2025_rnaSeq_RSRC | 12 | 4 | Germinated conidia_STAGE4×3, Germinated conidia_STAGE3×3, Germinated conidia_STAGE2×3, Conidia_STAGE1×3 | ✅ | {Germinated conidia_STAGE4} (3) vs {Germinated conidia_STAGE3, Germinated conidia_STAGE2, Conidia_STAGE1} (9) |
| bgrasphordeiiRACE1_Sucher_Bhordei_2018_rnaSeq_RSRC | 12 | 4 | Lr34_resist_barley_48×3, Lr34_resist_barley_5dpi×3, suscept_barley_48 hpi×3, suscept_barley_5dpi×3 | ✅ | {Lr34_resist_barley_48} (3) vs {Lr34_resist_barley_5dpi, suscept_barley_48 hpi, suscept_barley_5dpi} (9) |
| calbSC5314_Hollomon_Calb_2016_rnaSeq_RSRC | 8 | 8 | cyr1 delta-delta_pH4 rep1×1, cyr1 delta-delta_pH4 rep2×1, cyr1 delta-delta_pH7 rep1×1, cyr1 delta-delta_pH7 rep2×1, cyr1 delta-delta CYR1_pH4 rep1×1, cyr1 delta-delta CYR1_pH4 rep2×1, cyr1 delta-delta CYR1_pH7 rep1×1, cyr1 delta-delta CYR1_pH7 rep2×1 | ✅ | {cyr1 delta-delta_pH4 rep1, cyr1 delta-delta_pH4 rep2} (2) vs {cyr1 delta-delta_pH7 rep1, cyr1 delta-delta_pH7 rep2, cyr1 delta-delta CYR1_pH4 rep1, cyr1 delta-delta CYR1_pH4 rep2, cyr1 delta-delta CYR1_pH7 rep1, cyr1 delta-delta CYR1_pH7 rep2} (6) |
| foxy4287_foxy4287_Kim_2025_rnaSeq_RSRC | 18 | 6 | WT_conidia_STAGE1×3, WT_germ_conidia_STAGE2×3, WT_germ_conidia_STAGE3×3, WT_germ_conidia_STAGE4×3, deltaFoabaA_AfabaA_germ_conidia_STAGE4×3, deltaFoabaA_FoabaA_germ_conidia_STAGE4×3 | ✅ | {WT_conidia_STAGE1} (3) vs {WT_germ_conidia_STAGE2, WT_germ_conidia_STAGE3, WT_germ_conidia_STAGE4, deltaFoabaA_AfabaA_germ_conidia_STAGE4, deltaFoabaA_FoabaA_germ_conidia_STAGE4} (15) |
| foxy4287_foxy4287_Palos-Fernandez_2024_rnaSeq_RSRC | 24 | 8 | WT +Cu 6h×3, WT -Cu 6h×3, macA mutant +Cu 6h×3, macA mutant -Cu 6h×3, WT tomato root 2 dpi×3, WT tomato root 6 dpi×3, macA mutant tomato root 2 dpi×3, macA mutant tomato root 6 dpi×3 | ✅ | {WT +Cu 6h} (3) vs {WT -Cu 6h, macA mutant +Cu 6h, macA mutant -Cu 6h, WT tomato root 2 dpi, WT tomato root 6 dpi, macA mutant tomato root 2 dpi, macA mutant tomato root 6 dpi} (21) |
| foxy4287_foxy_Restrepo_2016_rnaSeq_RSRC | 3 | 3 | Amphotericin B×1, Posaconazole×1, DMSO control×1 | ❌ | — only 3 samples |
| fsolFSSC5MPISDFRAT0091_fsol_Restrepo_2016_rnaSeq_RSRC | 3 | 3 | Amphotericin B×1, Posaconazole×1, DMSO control×1 | ❌ | — only 3 samples |
| hsapREF_Xiao_Tspp_2023_rnaSeq_RSRC | 12 | 4 | untreated control×3, w T interdigitale×3, w T mentagrophytes×3, w T tonsurans×3 | ✅ | {untreated control} (3) vs {w T interdigitale, w T mentagrophytes, w T tonsurans} (9) |
| mmusC57BL6J_de-Souza-Silva_mmusC57BL6J_2020_rnaSeq_RSRC | 12 | 4 | AJ_untreated×3, AJ_Pb×3, B10A_untreated×3, B10A_Pb×3 | ✅ | {AJ_untreated} (3) vs {AJ_Pb, B10A_untreated, B10A_Pb} (9) |
| mmusC57BL6J_mmusC57BL6J_Guirao-Abad_2026_rnaSeq_RSRC | 8 | 2 | Pdgfra-GFP Saline Day7×4, PostnLin A. fumigatus Day7×4 | ✅ | {Pdgfra-GFP Saline Day7} (4) vs {PostnLin A. fumigatus Day7} (4) |
| mmusC57BL6J_mmusC57BL6J_Vanpala_2020_rnaSeq_RSRC | 12 | 6 | infected_FM+_CXCL2+×2, infected_FM+_CXCL2-×2, infected_FM-_CXCL2+×2, infected_FM-_CXCL2-×2, naive_FM+×2, naive_FM-×2 | ✅ | {infected_FM+_CXCL2+} (2) vs {infected_FM+_CXCL2-, infected_FM-_CXCL2+, infected_FM-_CXCL2-, naive_FM+, naive_FM-} (10) |
| mmusC57BL6J_mmusC57BL6J_Wang_2020_rnaSeq_RSRC | 18 | 6 | calbicans_3h×3, calbicans_6h×3, cauris_3h×3, cauris_6h×3, control_3h×3, control_6h×3 | ✅ | {calbicans_3h} (3) vs {calbicans_6h, cauris_3h, cauris_6h, control_3h, control_6h} (15) |
| mory70-15_Magna_WGCNA_Yan_2022_rnaSeq_RSRC | 72 | 24 | co39_leaf_drop_0h×3, co39_leaf_drop_144h×3, co39_leaf_drop_16h×3, co39_leaf_drop_24h×3, co39_leaf_drop_48h×3, co39_leaf_drop_72h×3, co39_leaf_drop_8h×3, co39_leaf_drop_96h×3, co39_leaf_spray_0h×3, co39_leaf_spray_144h×3, co39_leaf_spray_16h×3, co39_leaf_spray_24h×3, co39_leaf_spray_48h×3, co39_leaf_spray_72h×3, co39_leaf_spray_8h×3, co39_leaf_spray_96h×3, moukoto_leaf_spray_0h×3, moukoto_leaf_spray_144h×3, moukoto_leaf_spray_16h×3, moukoto_leaf_spray_24h×3, moukoto_leaf_spray_48h×3, moukoto_leaf_spray_72h×3, moukoto_leaf_spray_8h×3, moukoto_leaf_spray_96h×3 | ✅ | {co39_leaf_drop_0h} (3) vs {co39_leaf_drop_144h, co39_leaf_drop_16h, co39_leaf_drop_24h, co39_leaf_drop_48h, co39_leaf_drop_72h, co39_leaf_drop_8h, co39_leaf_drop_96h, co39_leaf_spray_0h, co39_leaf_spray_144h, co39_leaf_spray_16h, co39_leaf_spray_24h, co39_leaf_spray_48h, co39_leaf_spray_72h, co39_leaf_spray_8h, co39_leaf_spray_96h, moukoto_leaf_spray_0h, moukoto_leaf_spray_144h, moukoto_leaf_spray_16h, moukoto_leaf_spray_24h, moukoto_leaf_spray_48h, moukoto_leaf_spray_72h, moukoto_leaf_spray_8h, moukoto_leaf_spray_96h} (69) |
| mresKCTC27527_Park_mresKCTC27527_2020_rnaSeq_RSRC | 6 | 6 | KCTC27527_susceptible_control×1, KCTC27527_susceptible_ketoconazole×1, KCTC27529_resistant_control×1, KCTC27529_resistant_ketoconazole×1, KCTC27550_resistant_control×1, KCTC27550_resistant_ketoconazole×1 | ✅ | {KCTC27527_susceptible_control, KCTC27527_susceptible_ketoconazole} (2) vs {KCTC27529_resistant_control, KCTC27529_resistant_ketoconazole, KCTC27550_resistant_control, KCTC27550_resistant_ketoconazole} (4) |
| ncraOR74A_Leader_ncraOR74A_2013_rnaSeq_RSRC | 2 | 2 | WT 5h×1, delta_pp-1 5h×1 | ❌ | — only 2 samples |
| ncraOR74A_ncraOR74A_Belden_2019_rnaSeq_RSRC | 12 | 6 | WT_DD×2, WT_LP30×2, set1_DD×2, set1_LP30×2, dim5_DD×2, dim5_LP30×2 | ✅ | {WT_DD} (2) vs {WT_LP30, set1_DD, set1_LP30, dim5_DD, dim5_LP30} (10) |
| pcacP414_pcacP414_Yangzhou_2025_rnaSeq_RSRC | 3 | 3 | Mycelium×1, Zoospore×1, Germinating cyst×1 | ❌ | — only 3 samples |
| pinfT30-4_Shu_pinfT30-4_2024_rnaSeq_RSRC | 4 | 2 | 3dpi×2, 2dpi×2 | ✅ | {3dpi} (2) vs {2dpi} (2) |
| plinCAN1_plinCAN1_Clairet_2024_rnaSeq_RSRC | 16 | 8 | delta_LmPf2_A×2, delta_LmPf2_B×2, JN2×2, delta_kmt1×2, JN2_oPf2_A×2, JN2_oPf2_B×2, delta_kmt1_oPf2_B×2, delta_kmt1_oPf2_A×2 | ✅ | {delta_LmPf2_A} (2) vs {delta_LmPf2_B, JN2, delta_kmt1, JN2_oPf2_A, JN2_oPf2_B, delta_kmt1_oPf2_B, delta_kmt1_oPf2_A} (14) |
| ptri1-1BBBDRace1_Sucher_Ptriticina_2018_rnaSeq_RSRC | 6 | 2 | suscept_wheat×3, Lr34_resist_wheat×3 | ✅ | {suscept_wheat} (3) vs {Lr34_resist_wheat} (3) |
| rdelRA99-880_Sephton-Clark_RdelRA99_2018_rnaSeq_RSRC | 30 | 10 | 0hr×3, 1hr×3, 2hr×3, 3hr×3, 4hr×3, 5hr×3, 6hr×3, 12hr×3, 16hr×3, 24hr×3 | ✅ | {0hr} (3) vs {1hr, 2hr, 3hr, 4hr, 5hr, 6hr, 12hr, 16hr, 24hr} (27) |
| sscaArlian_Korhonen_stages_2020_rnaSeq_RSRC | 2 | 2 | eggs×1, mixed larvae and nymphs and adults×1 | ❌ | — only 2 samples |
| sscaArlian_Xu_stages_sexes_2022_rnaSeq_RSRC | 4 | 4 | adults×1, X4-6×1, X4-2×1, Mix1×1 | ✅ | {adults, X4-6} (2) vs {X4-2, Mix1} (2) |
| sscl1980UF-70_sscl1980UF-70_Kusch_2022_PAIRED_rnaSeq_RSRC | 24 | 8 | B_vulgaris_periphery×3, B_vulgaris_center×3, R_communis_periphery×3, R_communis_center×3, P_vulgaris_periphery×3, P_vulgaris_center×3, PDA_DMSO_control×3, PDA_camalexin_125uM×3 | ✅ | {B_vulgaris_periphery} (3) vs {B_vulgaris_center, R_communis_periphery, R_communis_center, P_vulgaris_periphery, P_vulgaris_center, PDA_DMSO_control, PDA_camalexin_125uM} (21) |
| sscl1980UF-70_sscl1980UF-70_Kusch_2022_SINGLE_rnaSeq_RSRC | 27 | 9 | PDB_liquid×3, PDA_periphery×3, PDA_center×3, A_thaliana_periphery×3, A_thaliana_center×3, S_lycopersicum_periphery×3, S_lycopersicum_center×3, H_annuus_periphery×3, H_annuus_center×3 | ✅ | {PDB_liquid} (3) vs {PDA_periphery, PDA_center, A_thaliana_periphery, A_thaliana_center, S_lycopersicum_periphery, S_lycopersicum_center, H_annuus_periphery, H_annuus_center} (24) |
| ttonCBS112818_Xiao_Tspp_2023_rnaSeq_RSRC | 5 | 1 | T. interdigitale_HaCaT_24h×5 | ❌ | — single label (no contrast) |
| umay521_Malesevic_umay521_2022_rnaSeq_RSRC | 3 | 3 | WT_0.7% H2O2×1, WT_0.4% H2O2×1, WT_10% YEPS×1 | ❌ | — only 3 samples |
| umay521_umaydis_Damoo_2024_rnaSeq_RSRC | 12 | 4 | 1 hour OFF-AM + 15µM FeCl3×3, 1 hour OFF-AM + 15µM hemin×3, 1 hour OFF-AM×3, 1 hour ON-NM×3 | ✅ | {1 hour OFF-AM + 15µM FeCl3} (3) vs {1 hour OFF-AM + 15µM hemin, 1 hour OFF-AM, 1 hour ON-NM} (9) |
| vdahJR2_Vd_Scholz_2018_rnaSeq_RSRC | 6 | 2 | hyphae×3, roots_hyphae×3 | ✅ | {hyphae} (3) vs {roots_hyphae} (3) |
| wsmiHCP4_Voshall_sex_brain_Wyeo_2020_rnaSeq_RSRC | 6 | 2 | adult male brain×3, adult female brain×3 | ✅ | {adult male brain} (3) vs {adult female brain} (3) |
