# DESeq-suitability test — Build 71 STF outputs

A dataset is **DESeq-suitable** only if its samples can be partitioned, by the
`label` field, into **two non-empty groups each with at least two samples**
(whole labels assigned to one side or the other). Equivalent to: some subset of
the per-label sample counts sums to a value between 2 and N−2 (N = total samples).

Datasets with ≥ 10 samples are almost always suitable and weren't the
point of the check, but are included since the test is scripted.

Source: `build72/outputs/<dataset>/entity-sample.tsv`

- Datasets tested: **23**
- DESeq-suitable: **22**
- NOT suitable: **1**

## DESeq-suitable

```
aaltSRC1lrK2f_aalt_Tang_2025_rnaSeq_RSRC
afumA1160_Weaver_2026_rnaSeq_RSRC
afumA1163_Weaver_2026_rnaSeq_RSRC
bcinB05-10_Naets_2022_rnaSeq_RSRC
bcinB05-10_Silva_2023_rnaSeq_RSRC
bcinB05-10_Vela-Corcia_2024_rnaSeq_RSRC
bgraTritici96224_Gong_2023_rnaSeq_RSRC
bgraTritici96224_Pham_2019_rnaSeq_RSRC
bgraTritici96224_Spanu_2010_rnaSeq_RSRC
bsorND90Pr_Bsorokiniana_McDonald_2018_rnaSeq_RSRC
celeBristolN2_Lazetic_2021_rnaSeq_RSRC
cglaCBS138_Rai_2023_rnaSeq_RSRC
fgraPH-1_Gu_2026_rnaSeq_RSRC
mlar98AG31_INRA_2021_rnaSeq_RSRC
osatNipponbare_Os_Mo_Glutamine_2016_rnaSeq_RSRC
osatNipponbare_Os_Po_Bidzinski_2016_rnaSeq_RSRC
pfal3D7_Zanghi_2025_rnaSeq_RSRC
pgraCRL75-36-700-3_SharmaPoudel_2019_rnaSeq_RSRC
pinfT30-4_Liao_2020_rnaSeq_RSRC
smanPuertoRico_Buddenborg_2023_rnaSeq_RSRC
umay521_McCotter_2023_rnaSeq_RSRC
ztriIPO323_UoE_2024_rnaSeq_RSRC
```

## NOT DESeq-suitable

```
foxyf.conglutinansFo5176_Ayukawa_2021_rnaSeq_RSRC
```

## Suitable, small (< 10 samples) — the ones the check actually mattered for

```
aaltSRC1lrK2f_aalt_Tang_2025_rnaSeq_RSRC
bcinB05-10_Silva_2023_rnaSeq_RSRC
bcinB05-10_Vela-Corcia_2024_rnaSeq_RSRC
bgraTritici96224_Gong_2023_rnaSeq_RSRC
bgraTritici96224_Pham_2019_rnaSeq_RSRC
bgraTritici96224_Spanu_2010_rnaSeq_RSRC
bsorND90Pr_Bsorokiniana_McDonald_2018_rnaSeq_RSRC
fgraPH-1_Gu_2026_rnaSeq_RSRC
mlar98AG31_INRA_2021_rnaSeq_RSRC
```

## Suitable, large (≥ 10 samples) — trivially expected

```
afumA1160_Weaver_2026_rnaSeq_RSRC
afumA1163_Weaver_2026_rnaSeq_RSRC
bcinB05-10_Naets_2022_rnaSeq_RSRC
celeBristolN2_Lazetic_2021_rnaSeq_RSRC
cglaCBS138_Rai_2023_rnaSeq_RSRC
osatNipponbare_Os_Mo_Glutamine_2016_rnaSeq_RSRC
osatNipponbare_Os_Po_Bidzinski_2016_rnaSeq_RSRC
pfal3D7_Zanghi_2025_rnaSeq_RSRC
pgraCRL75-36-700-3_SharmaPoudel_2019_rnaSeq_RSRC
pinfT30-4_Liao_2020_rnaSeq_RSRC
smanPuertoRico_Buddenborg_2023_rnaSeq_RSRC
umay521_McCotter_2023_rnaSeq_RSRC
ztriIPO323_UoE_2024_rnaSeq_RSRC
```

## Details

| Dataset | N | Labels | Composition | Suitable | Example split / reason |
|---|---|---|---|---|---|
| aaltSRC1lrK2f_aalt_Tang_2025_rnaSeq_RSRC | 4 | 4 | Wild-type Control×1, Wild-type Leaf×1, delta-AaSom1 Control×1, delta-AaSom1 Leaf×1 | ✅ | {Wild-type Control, Wild-type Leaf} (2) vs {delta-AaSom1 Control, delta-AaSom1 Leaf} (2) |
| afumA1160_Weaver_2026_rnaSeq_RSRC | 81 | 27 | 5-Fluorocytosine 0.5 MIC×3, 5-Fluorocytosine 1 MIC×3, 5-Fluorocytosine 2 MIC×3, 5-Fluorocytosine 4 MIC×3, Dodine 0.5 MIC×3, Dodine 1 MIC×3, Dodine 2 MIC×3, Dodine 4 MIC×3, Hygromycin B 0.5 MIC×3, Hygromycin B 1 MIC×3, Hygromycin B 2 MIC×3, Hygromycin B 4 MIC×3, Miltefosine 0.5 MIC×3, Miltefosine 1 MIC×3, Miltefosine 2 MIC×3, Miltefosine 4 MIC×3, Simvastatin 0.5 MIC×3, Simvastatin 1 MIC×3, Simvastatin 2 MIC×3, Simvastatin 4 MIC×3, Terbinafine 0.5 MIC×3, Terbinafine 1 MIC×3, Terbinafine 2 MIC×3, Terbinafine 4 MIC×3, Untreated Lot 1×3, Untreated Lot 2×3, Untreated Lot 3×3 | ✅ | {5-Fluorocytosine 0.5 MIC} (3) vs {5-Fluorocytosine 1 MIC, 5-Fluorocytosine 2 MIC, 5-Fluorocytosine 4 MIC, Dodine 0.5 MIC, Dodine 1 MIC, Dodine 2 MIC, Dodine 4 MIC, Hygromycin B 0.5 MIC, Hygromycin B 1 MIC, Hygromycin B 2 MIC, Hygromycin B 4 MIC, Miltefosine 0.5 MIC, Miltefosine 1 MIC, Miltefosine 2 MIC, Miltefosine 4 MIC, Simvastatin 0.5 MIC, Simvastatin 1 MIC, Simvastatin 2 MIC, Simvastatin 4 MIC, Terbinafine 0.5 MIC, Terbinafine 1 MIC, Terbinafine 2 MIC, Terbinafine 4 MIC, Untreated Lot 1, Untreated Lot 2, Untreated Lot 3} (78) |
| afumA1163_Weaver_2026_rnaSeq_RSRC | 18 | 6 | No drug×3, 0.25x×3, 0.5x×3, 1x×3, 2x×3, 4x×3 | ✅ | {No drug} (3) vs {0.25x, 0.5x, 1x, 2x, 4x} (15) |
| bcinB05-10_Naets_2022_rnaSeq_RSRC | 12 | 4 | Inoculated 0 hpi×3, Inoculated 1 hpi×3, Inoculated 12 hpi×3, Inoculated 28 hpi×3 | ✅ | {Inoculated 0 hpi} (3) vs {Inoculated 1 hpi, Inoculated 12 hpi, Inoculated 28 hpi} (9) |
| bcinB05-10_Silva_2023_rnaSeq_RSRC | 6 | 2 | Mature green fruit×3, Red-ripe fruit×3 | ✅ | {Mature green fruit} (3) vs {Red-ripe fruit} (3) |
| bcinB05-10_Vela-Corcia_2024_rnaSeq_RSRC | 6 | 2 | CycloPro_Tyr×3, DMSO×3 | ✅ | {CycloPro_Tyr} (3) vs {DMSO} (3) |
| bgraTritici96224_Gong_2023_rnaSeq_RSRC | 7 | 6 | 0_hpi×1, 24_hpi×2, 36_hpi×1, 48_hpi×1, 72_hpi×1, 144_hpi×1 | ✅ | {24_hpi} (2) vs {0_hpi, 36_hpi, 48_hpi, 72_hpi, 144_hpi} (5) |
| bgraTritici96224_Pham_2019_rnaSeq_RSRC | 6 | 2 | Ungerminated conidia×3, Germinated conidia 6h×3 | ✅ | {Ungerminated conidia} (3) vs {Germinated conidia 6h} (3) |
| bgraTritici96224_Spanu_2010_rnaSeq_RSRC | 6 | 2 | Epiphytic structures×3, Haustoria×3 | ✅ | {Epiphytic structures} (3) vs {Haustoria} (3) |
| bsorND90Pr_Bsorokiniana_McDonald_2018_rnaSeq_RSRC | 7 | 7 | V8_juice×1, Min_wheat_extr×1, PDB_5-Azacytidine×1, PDB×1, Fries3×1, Min×1, Modified Fries3×1 | ✅ | {V8_juice, Min_wheat_extr} (2) vs {PDB_5-Azacytidine, PDB, Fries3, Min, Modified Fries3} (5) |
| celeBristolN2_Lazetic_2021_rnaSeq_RSRC | 24 | 8 | Wild-type vehicle control 0.5h×3, Wild-type bortezomib 0.5h×3, zip-1jy13 vehicle control 0.5h×3, zip-1jy13 bortezomib 0.5h×3, Wild-type vehicle control 4h×3, Wild-type bortezomib 4h×3, zip-1jy13 vehicle control 4h×3, zip-1jy13 bortezomib 4h×3 | ✅ | {Wild-type vehicle control 0.5h} (3) vs {Wild-type bortezomib 0.5h, zip-1jy13 vehicle control 0.5h, zip-1jy13 bortezomib 0.5h, Wild-type vehicle control 4h, Wild-type bortezomib 4h, zip-1jy13 vehicle control 4h, zip-1jy13 bortezomib 4h} (21) |
| cglaCBS138_Rai_2023_rnaSeq_RSRC | 12 | 6 | 30C control×2, 37C×2, 42C heat stress×2, NaCl osmotic stress×2, SDS cell wall stress×2, Hydroxyurea genotoxic stress×2 | ✅ | {30C control} (2) vs {37C, 42C heat stress, NaCl osmotic stress, SDS cell wall stress, Hydroxyurea genotoxic stress} (10) |
| fgraPH-1_Gu_2026_rnaSeq_RSRC | 6 | 2 | 25C×3, 34C×3 | ✅ | {25C} (3) vs {34C} (3) |
| foxyf.conglutinansFo5176_Ayukawa_2021_rnaSeq_RSRC | 3 | 3 | PDA_mycelia×1, NO3_budcells×1, NO3_hypha×1 | ❌ | — only 3 samples |
| mlar98AG31_INRA_2021_rnaSeq_RSRC | 9 | 3 | PT_Basidia×3, LD_Pycnia×3, LD_Aecia×3 | ✅ | {PT_Basidia} (3) vs {LD_Pycnia, LD_Aecia} (6) |
| osatNipponbare_Os_Mo_Glutamine_2016_rnaSeq_RSRC | 18 | 6 | 0N Before inoculation×3, 1N Before inoculation×3, 0N Mock inoculated×3, 0N Guy11 inoculated×3, 1N Mock inoculated×3, 1N Guy11 inoculated×3 | ✅ | {0N Before inoculation} (3) vs {1N Before inoculation, 0N Mock inoculated, 0N Guy11 inoculated, 1N Mock inoculated, 1N Guy11 inoculated} (15) |
| osatNipponbare_Os_Po_Bidzinski_2016_rnaSeq_RSRC | 12 | 4 | Drought Fr13 inoculated×3, No drought Fr13 inoculated×3, Drought Mock inoculated×3, No drought Mock inoculated×3 | ✅ | {Drought Fr13 inoculated} (3) vs {No drought Fr13 inoculated, Drought Mock inoculated, No drought Mock inoculated} (9) |
| pfal3D7_Zanghi_2025_rnaSeq_RSRC | 13 | 5 | Sporozoite×1, Liver stage day 2×3, Liver stage day 4×3, Liver stage day 5×3, Liver stage day 6×3 | ✅ | {Liver stage day 2} (3) vs {Sporozoite, Liver stage day 4, Liver stage day 5, Liver stage day 6} (10) |
| pgraCRL75-36-700-3_SharmaPoudel_2019_rnaSeq_RSRC | 24 | 24 | 370C_v_rpg4/5_avr_Rpg1×1, 640C_v_rpg4/5_avr_Rpg1×1, 72-41-SP-2_v_Rpg1_avr_rpg4/5×1, 72_00_v_Rpg1_avr_rpg4/5×1, 79-1_v_Rpg1_avr_rpg4/5×1, 79.2_v_Rpg1_avr_rpg4/5×1, 79_20_v_Rpg1_avr_rpg4/5×1, 81AC28_avr_rpg4/5_avr_Rpg1×1, 81AC34_avr_rpg4/5_avr_Rpg1×1, 81AC46_avr_rpg4/5_avr_Rpg1×1, A-12_avr_rpg4/5_avr_Rpg1×1, A-14_v_rpg4/5_avr_Rpg1×1, A-15_v_rpg4/5_avr_Rpg1×1, A-21_v_rpg4/5_avr_Rpg1×1, A-48_v_rpg4/5_avr_Rpg1×1, A-5_avr_rpg4/5_avr_Rpg1×1, AC-12_avr_rpg4/5_avr_Rpg1×1, P84-16_v_Rpg1_avr_rpg4/5×1, QCCJ_v_Rpg1_avr_rpg4/5×1, R11c_v_Rpg1_avr_rpg4/5×1, R29JA_v_rpg4/5_avr_Rpg1×1, R29JB_v_rpg4/5_avr_Rpg1×1, R29M_v_rpg4/5_avr_Rpg1×1, WM1_avr_rpg4/5_avr_Rpg1×1 | ✅ | {370C_v_rpg4/5_avr_Rpg1, 640C_v_rpg4/5_avr_Rpg1} (2) vs {72-41-SP-2_v_Rpg1_avr_rpg4/5, 72_00_v_Rpg1_avr_rpg4/5, 79-1_v_Rpg1_avr_rpg4/5, 79.2_v_Rpg1_avr_rpg4/5, 79_20_v_Rpg1_avr_rpg4/5, 81AC28_avr_rpg4/5_avr_Rpg1, 81AC34_avr_rpg4/5_avr_Rpg1, 81AC46_avr_rpg4/5_avr_Rpg1, A-12_avr_rpg4/5_avr_Rpg1, A-14_v_rpg4/5_avr_Rpg1, A-15_v_rpg4/5_avr_Rpg1, A-21_v_rpg4/5_avr_Rpg1, A-48_v_rpg4/5_avr_Rpg1, A-5_avr_rpg4/5_avr_Rpg1, AC-12_avr_rpg4/5_avr_Rpg1, P84-16_v_Rpg1_avr_rpg4/5, QCCJ_v_Rpg1_avr_rpg4/5, R11c_v_Rpg1_avr_rpg4/5, R29JA_v_rpg4/5_avr_Rpg1, R29JB_v_rpg4/5_avr_Rpg1, R29M_v_rpg4/5_avr_Rpg1, WM1_avr_rpg4/5_avr_Rpg1} (22) |
| pinfT30-4_Liao_2020_rnaSeq_RSRC | 13 | 5 | NL88069 mycelia×2, NL11388 mycelia×2, NL88069 infected leaf 5dpi×3, NL11388 infected leaf 5dpi×3, Mock leaf 5dpi×3 | ✅ | {NL88069 mycelia} (2) vs {NL11388 mycelia, NL88069 infected leaf 5dpi, NL11388 infected leaf 5dpi, Mock leaf 5dpi} (11) |
| smanPuertoRico_Buddenborg_2023_rnaSeq_RSRC | 75 | 15 | Egg mixed×5, Miracidia mixed×5, Primary sporocyst 1 day mixed×5, Primary sporocyst 5 day mixed×5, Secondary sporocyst 32 day female×5, Secondary sporocyst 32 day male×5, Secondary sporocyst 32 day mixed×5, Cercariae female×5, Cercariae male×5, Cercariae mixed×5, Schistosomule 2 day female×5, Schistosomule 2 day male×5, Schistosomule 2 day mixed×5, Juvenile worm 26 day female×5, Juvenile worm 26 day male×5 | ✅ | {Egg mixed} (5) vs {Miracidia mixed, Primary sporocyst 1 day mixed, Primary sporocyst 5 day mixed, Secondary sporocyst 32 day female, Secondary sporocyst 32 day male, Secondary sporocyst 32 day mixed, Cercariae female, Cercariae male, Cercariae mixed, Schistosomule 2 day female, Schistosomule 2 day male, Schistosomule 2 day mixed, Juvenile worm 26 day female, Juvenile worm 26 day male} (70) |
| umay521_McCotter_2023_rnaSeq_RSRC | 12 | 4 | Wildtype glucose×3, Wildtype arabinose×3, Pcrg1:grx4 glucose×3, Pcrg1:grx4 arabinose×3 | ✅ | {Wildtype glucose} (3) vs {Wildtype arabinose, Pcrg1:grx4 glucose, Pcrg1:grx4 arabinose} (9) |
| ztriIPO323_UoE_2024_rnaSeq_RSRC | 19 | 5 | YPD control×4, 1h water stress×4, 4h water stress×4, 24h water stress×3, 7 days water stress×4 | ✅ | {24h water stress} (3) vs {YPD control, 1h water stress, 4h water stress, 7 days water stress} (16) |
