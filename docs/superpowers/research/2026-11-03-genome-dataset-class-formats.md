# Annotated-genome dataset classes: input contract

Reference for producing manual-delivery inputs for the annotated-genome dataset classes. Every claim cites file:line; **(inferred)** marks reasoning that was not read directly in code.

## Sources and abbreviations

| Abbrev | Path |
|---|---|
| `CX` | `VEuPathDatasets/Model/lib/xml/datasetClass/classes.xml` (classes.xml lives in **VEuPathDatasets**, not ApiCommonModel) |
| `GSF` | `ApiCommonWorkflow/Main/lib/xml/workflowTemplates/genomeSequenceAndFeatures.xml` |
| `PX` | `ApiCommonWorkflow/Main/lib/xml/workflowTemplates/project.xml` |
| `LD` | `ApiCommonWorkflow/Main/lib/xml/workflow/loadDataset.xml` |
| `GU` | `ApiCommonWorkflow/Main/lib/perl/WorkflowSteps/DatasetLoaderGetAndUnpack.pm` |
| `RLS` | `ApiCommonWorkflow/Main/lib/perl/WorkflowSteps/DatasetLoaderInsertExtDbRls.pm` |
| `ACD/...` | `ApiCommonData/Load/...` |
| `GAF/...` | VEuPathDB/GusAppFramework on GitHub (master @ `1032fbf`). It is **not checked out locally**; I fetched it read-only with `gh api` |
| `CBIL/...` | VEuPathDB/CBIL on GitHub (master @ `81061b1`), fetched the same way |
| `fgra` | `VEuPathDatasets/Datasets/lib/xml/datasets/FungiDB/fgraPH-1.xml` |

Usage counts ("in practice") come from a scan of every `Datasets/lib/xml/datasets/*/*.xml` file with XML comments stripped.

---

## 0. Cross-cutting mechanics (read first)

### 0.1 None of these classes use `<unpack>ln -s @@manualDeliveryDir@@`
- All 14 loader classes use `<manualGet fileOrDir="...">` instead (for example CX:624, CX:841, CX:2815).
- `GU:50-55` runs `cp -Lr $manualDeliveryDir/$manualFileOrDir $targetDir`. The fileOrDir path is relative to `manualDeliveryDir`.
  - When fileOrDir ends in `.../final/`, the copy lands at `@@dataDir@@/final/...`.
  - When fileOrDir ends in a file such as `.../final/products.txt`, the copy lands at `@@dataDir@@/products.txt`. That is why the pluginArgs paths differ between classes (inferred from `cp -r` semantics).
- `@@dataDir@@` = `$$parentDataDir$$/$$datasetName$$` (LD:7).
- **dataset-curator impact:** `parseDatasetClass` (`dataset-curator/shared/scripts/lib/dataset-classes.js:24-26`) matches only `<unpack>ln -s @@manualDeliveryDir@@/...`.
  - I ran it against all 15 classes. All 14 loader classes throw "has no `<unpack>ln -s ...` line".
  - validateOrganismInfo throws "has no datasetLoader datasetName".
  - The parser needs a `manualGet fileOrDir` branch.
- `IDENTITY_PROPS = ['projectName','organismAbbrev','name','version']` (dataset-classes.js:7) does not cover these classes:
  - `NoPreprocess_primary_genome_features` uses `${source}` (CX:624).
  - Any `${soTerm}` path (CX:654, CX:841) is not in that list either.

### 0.2 Parent datasets share one external-database release
- A loader with `parentDatasetName` does not create its own ext db or release (`DatasetLoaderInsertExtDb.pm:15-17`, RLS:25-34). It must also not set `externalDbIdType`, `externalDbIdUrl` or `releaseDate` (RLS:28-29).
- Secondary FASTA, organelle FASTA and all three NoPreprocess feature classes load with `--extDbName/--externalDatabaseName %PARENT_DATASET_NAME%` / `%PARENT_DATASET_VERSION%`, where the parent is `${organismAbbrev}_primary_genome_RSRC` (CX:618/630, 648/659, 677/688, 867/877, 897/906).
- Consequences:
  - Every sequence and every gene/transcript lands in the single release `<org>_primary_genome_RSRC|<fasta_primary version>`.
  - The features datasets' own `version` affects only the delivery path, never DB identity. The value of `%PARENT_DATASET_VERSION%` is (inferred) the parent's `version` (RLS:26,31 reads it). I could not find the substitution code locally.
  - Downstream code keys off this one release: `genomeExtDbRlsSpec = ${organismAbbrev}_primary_genome_RSRC|${genomeVersion}` (PX:196, 312, 445, 456, 475, 500). geneName and dbxref_simple take `genomeVersion` as a prop for the same reason (CX:5235, CX:1694).
  - **Hard invariant:** organism `genomeVersion` == fasta_primary `version` == `genomeVersion` prop on geneName and dbxref_simple. In practice all are `$$genomeVersion$$`: fasta_primary 26/27, geneName 137/137, dbxref_simple 606/606.

### 0.3 Load order (graph)
- **project.xml organism template:**
  - `LoadGenome` (PX:178) contains `genomeSequenceAndFeatures` (`loadGenome.xml:75-80`).
  - `MaskGenome` depends on LoadGenome (PX:259, PX:274).
  - `PostLoadGenome` depends on MaskGenome (PX:305, PX:328). It contains `genesAndProteins.xml`, gated on `isAnnotatedGenome` (`postLoadGenome.xml:54`), which contains `productNames.xml` (`genesAndProteins.xml:39-44`).
  - `LoadAliases` depends on LoadGenome (PX:438-448).
  - `specific` (OrganismSpecific, which holds GO, EC, comments and geneName via organismSpecificMisc) depends on LoadAliases (PX:469-486, `OrganismSpecific.xml:35`).
  - `dbXRefs` (dbxref_simple, dbxref_synonym) depends on LoadAliases (PX:488-502).
- **Inside GSF:**
  - fasta_primary has no deps (GSF:96-104).
  - fasta_secondary and fasta_organelle depend on `primary_genome_RSRC` (GSF:188-199, 239-250).
  - NoPreprocess_primary depends **only** on `primary_genome_RSRC` (GSF:264-273).
  - NoPreprocess_secondary depends on `${soTerm}_${name}_secondary_genome_RSRC` (GSF:284).
  - NoPreprocess_organelle depends on `${soTerm}_${name}_RSRC` (GSF:297).
  - validateOrganismInfo has no deps (GSF:16-30). It runs after insertOrganism because GSF depends on `makeDataDir`, which depends on `insertOrganism` (`loadGenome.xml:57-60,79`).

---

## 1. Summary table

| Class | datasetName | manualGet (relative to `@@manualDeliveryDir@@`) | File(s) the plugin reads | Format | Plugin |
|---|---|---|---|---|---|
| fasta_primary_genome_sequence | `${org}_primary_genome_RSRC` | `${project}/${org}/genome/${soTerm}_${name}_fasta/${version}/final/` | `final/genome.fasta`, `final/chromosomeMap.txt` | FASTA + TSV | GUS::Supported::Plugin::LoadFastaSequences |
| fasta_secondary_genome | `${org}_${soTerm}_${name}_RSRC` | `.../genome/${soTerm}_${name}_fasta/${version}/final/` | `final/genome.fasta`, `final/chromosomeMap.txt` (empty) | FASTA | LoadFastaSequences |
| fasta_organelle_genome | `${org}_${soTerm}_${name}_RSRC` | `.../genome/${soTerm}_${name}_fasta/${version}/final/genome.fasta` (**file**) | `genome.fasta` (no `final/`) | FASTA | LoadFastaSequences |
| NoPreprocess_primary_genome_features | `${org}_primary_genome_features_RSRC` | `.../genome/${soTerm}_${source}_gff3/${version}/final/` | `final/genome.gff`, **`final/transcriptInfoAndIds`**; chromosome map read from the *sequence* dataset dir | GFF3 + TSV | GUS::Supported::Plugin::InsertSequenceFeatures |
| NoPreprocess_secondary_genome_features | `${org}_${soTerm}_genome_features_RSRC` (no `name`) | `.../genome/${soTerm}_${name}_gff3/${version}/final/` | `final/genome.gff`, `final/transcriptInfoAndIds` | GFF3 | ISF |
| NoPreprocess_organelle_genome_features | `${org}_${soTerm}_${name}_features_RSRC` | `.../genome/${soTerm}_${name}_gff3/${version}/final/` | `final/genome.gff`, `final/transcriptInfoAndIds` | GFF3 | ISF |
| productNames | `${org}_function_${name}_product_names_RSRC` | `.../function/${name}_product_names/${version}/final/products.txt` | `processed_products.txt` (made by an unpack step from `products.txt`) | 7-col TSV | ApiCommonData::Load::Plugin::InsertProductFromTabFile |
| GeneOntologyAssociations | `${org}_${name}_GOAssociations_RSRC` | `.../function/${name}_GOAssociations/${version}/final/associations.gas` | `associations.gas` | GAF 2.x (≥14 cols) | ApiCommonData::Load::Plugin::InsertGOAssociationsSimple |
| EnzymeCommissionAssociations | `${org}_${name}_ECAssociations_RSRC` | `.../function/${name}_ECAssociations/${version}/final/ec.txt` | `ec.txt` | 2-col TSV (**protein ID**, EC) | GUS::Community::Plugin::InsertECMapping |
| geneName | `${org}_gene_name_${name}_RSRC` | `.../function/${name}_gene_names/${version}/final/geneName.txt` | `geneName.txt` | 2-col TSV (gene ID, name) | ApiCommonData::Load::Plugin::InsertGeneNamesFromTabFile |
| dbxref_synonym | `${org}_dbxref_${name}_synonym_RSRC` | `.../function/synonym/${name}/${version}/final/synonyms.txt` | `synonyms.txt` | 2-col TSV (gene ID, synonym) | ApiCommonData::Load::Plugin::InsertDBxRefs |
| comments | `${org}_${name}_comments_RSRC` | `.../comment/${name}/${version}/final/comments.txt` | `comments.txt` | 2–3-col TSV | ApiCommonData::Load::Plugin::InsertNaFeatCommentFromTabFile |
| aliases | `${org}_${name}_${target}_aliases_RSRC` | `.../alias/${name}/${version}/final/aliases.txt` | `aliases.txt` | 2-col TSV (current ID, alias) | InsertDBxRefs |
| dbxref_simple | `${org}_dbxref_${name}_RSRC` | `.../dbxref/${name}/${version}/final/mapping.txt` | `mapping.txt` | TSV (ID + columnSpec cols) | InsertDBxRefs |

Citations by row: CX:834/841/846; 895/901/906; 865/872/877; 616/624/630; 646/654/659; 675/683/688; 2809/2815/2819-2820; 3172/3176/3181; 3207/3212/3217; 5225/5231/5235; 1771/1779/1784; 3287/3293/3298; 1808/1819/1824; 1680/1689/1694.

---

## 2. Sequence classes

### 2.1 fasta_primary_genome_sequence (CX:818-848)
- **Props (CX:820-828):** projectName, organismAbbrev, ncbiTaxonId, name, version, `table` ("Ignore", CX:825), soTerm `[chromosome, supercontig, contig]`, sourceIdRegex, releaseDate.
  - Identity / path props: projectName, organismAbbrev, soTerm, name, version (CX:841).
  - In practice (25 datasets): name `$$genomeSource$$` 14, `$$source$$` 5. version `$$genomeVersion$$` 26/27 instances. soTerm `$$soTerm$$` 18. sourceIdRegex `^>(\S+)` or `^&gt;(\S+)` (XML-escaped, 11 each). table `DoTS::ExternalNASequence` 25/25. releaseDate mostly empty.
  - The worked example is fgra:41-51.
- **releaseDate:** fasta_primary has no parent, so `releaseDate` goes to InsertExternalDatabaseRls. It must be empty or `yyyy-mm-dd`, otherwise the step errors (RLS:40-41).
- **Graph:** GSF:96-104 (subgraph `primary_genome_RSRC`).
- **Plugin args (CX:846):**
  - `--externalDatabaseName %DATASET_NAME% --externalDatabaseVersion %DATASET_VERSION% --ncbiTaxId ${ncbiTaxonId}`
  - `--sequenceFile @@dataDir@@/final/genome.fasta --chromosomeMapFile @@dataDir@@/final/chromosomeMap.txt`
  - `--soTermName ${soTerm} --regexSourceId "${sourceIdRegex}" --tableName "DoTS::ExternalNASequence"` (hard-coded; the `table` prop is unused here)
- **FASTA rules (GAF/Supported/plugin/perl/LoadFastaSequences.pm):**
  - Defline: trailing whitespace including DOS `\r` is trimmed (:410).
  - The source ID is `$1` of `regexSourceId`. A missing capture is a userError (:435-442).
  - The source ID must equal GFF column 1 exactly, because ISF looks the sequence up by `source_id` (see 3.x).
  - The sequence file is read as-is; `.gz` is honoured only if the file name ends in `gz` (:377-381), and the name here is fixed as `genome.fasta`.
  - A duplicate source_id already present in the same ext-db release is **silently skipped** (:558, check SQL :346). This includes IDs loaded by an earlier primary/secondary/organelle FASTA, since they share the release.
  - The SO term is resolved by name in `SO_RSRC`. An unresolvable term errors (:757-791).
  - `--soTermName` vs declared `SOTermName` (:109): the case-insensitive match is (inferred) from Getopt.
- **chromosomeMap.txt:**
  - Read only when `SOTermName eq 'chromosome'` (:402). Then `getChromosomeMapping` dies if the file can't be opened (:926-929).
  - Format (:934): `source_id \t chromosome_name \t chromosome_order_num`. Sets `chromosome` and `chromosome_order_num` on ExternalNASequence (:582-585, :643-647).
  - The class docs say it must exist (empty) when soTerm is not chromosome (CX:842). The plugin does not open it in that case (code above), but `cp` just copies whatever is in `final/`.

### 2.2 fasta_secondary_genome (CX:881-908)
- **Props:** same as primary minus releaseDate. soTerm `[supercontig, contig, random_sequence]` (CX:889).
  - In practice (15): soTerm `supercontig` 9, `contig` 6 (always literal); name `$$genomeSource$$` 9.
- **`table` is NOT ignorable here:** pluginArgs pass `--tableName "${table}"` (CX:906), and the plugin requires it (LoadFastaSequences.pm:223-227). It is always `DoTS::ExternalNASequence` in practice (15/15).
- **Loader:** `--externalDatabaseName %PARENT_DATASET_NAME%`, so sequences go into the primary release (§0.2). sequenceFile `@@dataDir@@/final/genome.fasta`; chromosomeMap `final/chromosomeMap.txt`, which is "should be empty" (CX:902) and never read since soTerm ≠ chromosome.
- **Graph:** subgraph name `${soTerm}_${name}_secondary_genome_RSRC`, depends on `primary_genome_RSRC` (GSF:188-199).
- **Uniqueness:** one per (soTerm, name) pair per organism (datasetName CX:895).

### 2.3 fasta_organelle_genome (CX:850-879)
- **Props:** primary set minus releaseDate, plus `organelle` (CX:860). soTerm `[mitochondrial_chromosome, apicoplast_chromosome]` (CX:858).
  - In practice (11): `mitochondrial_chromosome` 8, `maxicircle` 2, `chloroplast_chromosome` 1. organelle `mitochondrion` 8, `maxicircle` 2, `chloroplast` 1.
- **`organelle` is not consumed by the loader** (CX:865-877). The GSF template does not declare it (GSF:239-242).
  - Its only use is `make_${organelle}_webServiceFiles` in `workflowTemplates/makeOrganelleWebServiceFiles.xml:33-52`. That template is not referenced anywhere in ApiCommonWorkflow (grep). It is effectively dead today (inferred).
- **manualGet is a file:** `.../final/genome.fasta` (CX:872). It is copied to `@@dataDir@@/genome.fasta`, and pluginArgs use `--sequenceFile @@dataDir@@/genome.fasta` (CX:877). There is no chromosomeMap. `--tableName "${table}"` is required.
- **Graph:** subgraph `${soTerm}_${name}_RSRC`, depends on `primary_genome_RSRC` (GSF:239-250).
- A comment flags a planned datasetName change: "when rebuild, remove ${name} from datasetName" (CX:864, CX:894).

---

## 3. Structural features: NoPreprocess_* (ISF)

### 3.1 Props and paths

| | primary (CX:604-632) | secondary (CX:634-661) | organelle (CX:663-690) |
|---|---|---|---|
| props | projectName, organismAbbrev, ncbiTaxonId, version, soTerm, **source**, mapFile | …, soTerm, **name**, mapFile | …, soTerm, **name**, mapFile |
| path | `genome/${soTerm}_${source}_gff3/${version}/final/` (624) | `genome/${soTerm}_${name}_gff3/${version}/final/` (654) | same pattern (683) |
| datasetName | `${org}_primary_genome_features_RSRC` (616) | `${org}_${soTerm}_genome_features_RSRC` (646) | `${org}_${soTerm}_${name}_features_RSRC` (675) |
| graph dep | `primary_genome_RSRC` (GSF:271) | `${soTerm}_${name}_secondary_genome_RSRC` (GSF:284) | `${soTerm}_${name}_RSRC` (GSF:297) |
| `--chromosomeMapFile` | `@@dataDir@@/../${org}_primary_genome_RSRC/final/chromosomeMap.txt` (630) | `@@dataDir@@/../${org}_secondary_genome_RSRC/final/chromosomeMap.txt` (659); this dir never exists | none (688) |

- **Pairing rule (graph-enforced):**
  - A secondary features dataset's `soTerm` + `name` must equal its FASTA's `soTerm` + `name`. Otherwise the `<depends>` names a nonexistent subgraph (GSF:192 vs GSF:284).
  - The same holds for organelle (GSF:243 vs GSF:297).
  - Only one secondary features dataset is possible per soTerm, because datasetName drops `name` (CX:646).
- **In practice:**
  - Primary (22): mapFile `genemRNAExonCDS2Gus.xml` 16. Others: `geneDBGFF2Gus.xml` 2, `geneOnly2Gus.xml`, `genemRNACdsUtr2GUS.xml`, `genemRNAExonCDSTranscript2gbkey2Gus.xml`, `FungiDB/genericGFF2Gus.xml`. source `$$genomeSource$$` 11, `$$source$$` 5. version `$$genomeVersion$$` 17.
  - Secondary (11): soTerm supercontig 6, contig 5.
  - Organelle (4): all mitochondrial_chromosome. All carry an extra `organelle` prop, which is not a class prop.
- **fgra:** one primary features dataset with source `VEuPathDB` and version `2024-07-26` (fgra:53-61). It has FASTA secondary and organelle datasets but **no** secondary or organelle features datasets (fgra:63-84).

### 3.2 Plugin args (common to all three; CX:630/659/688)
- `--extDbName %PARENT_DATASET_NAME% --extDbRlsVer %PARENT_DATASET_VERSION% --mapFile @@gusHome@@/lib/xml/isf/${mapFile}`
- `--inputFileOrDir @@dataDir@@/final/genome.gff --fileFormat gff3 --soExtDbSpec "SO_RSRC|%" --defaultOrganism ${ncbiTaxonId} --seqSoTerm '${soTerm}'`
- `--seqIdColumn source_id --naSequenceSubclass ExternalNASequence`
- `--postprocessingDirective SET_TRANSCRIPT_IDS --postprocessingDir @@dataDir@@/final/`
- `--validationLog @@dataDir@@/final/validation.log --bioperlTreeOutput ...`

### 3.3 Required files in `final/` (the class docs under-state this)
- **genome.gff** is the single GFF3 file. ISF errors if inputFileOrDir is a directory with gff (GAF/Supported/plugin/perl/InsertSequenceFeatures.pm:629).
- **transcriptInfoAndIds** is **mandatory**. `SET_TRANSCRIPT_IDS` opens `$postprocessDir/transcriptInfoAndIds` or dies (ACD/lib/perl/GusSkeletonMaker.pm:524-528).
  - The NoPreprocess descriptionOfFinal omits it (CX:625, 655, 684). The GeneDB sibling class documents it (CX:493).
  - **Format** (GusSkeletonMaker.pm:531-533): `geneId \t transcriptSeq \t exonPath \t exonLocations \t transcriptId`. geneId, transcriptSeq and transcriptId are required.
  - **Lookup key:** `(geneId, transcriptSeq with [^ATCG]→N, sorted exon order numbers joined by ",")`. A miss dies (:543-558).
  - **The final transcript `source_id` comes from this file, not the GFF** (:553-555).
  - **How it is produced:** an ISF pre-run with `--postprocessingDirective PRINT_TRANSCRIPT_IDS` writes `transcriptIds` (GusSkeletonMaker.pm:433-475), which is then copied to `final/transcriptInfoAndIds` (ACD/bin/printIsfTestingCommandsGus4:72-75). That pre-run needs a GUS DB with the sequences loaded.
- **chromosomeMap.txt** is listed by the docs (CX:625, 655). ISF reads the chromosome map only when `seqSoTerm eq 'chromosome'` (InsertSequenceFeatures.pm:472-474), and for primary it reads the **sequence** dataset's copy (CX:630). The map is used only in `constructNASequence` (:863), which is not called when `--naSequenceSubclass` is given (:782-790). So it is effectively unused for features (inferred).

### 3.4 How features link to sequences
- GFF3 column 1 (`seq_id`) groups features into pseudo-sequences (InsertSequenceFeatures.pm:639-651).
- Each group is looked up as `ExternalNASequence(external_database_release_id = <primary_genome_RSRC release>, source_id = seq_id)`. A miss is a fatal `die` (:793-813).
- **`--seqSoTerm` is not used for the lookup.** Any sequence in the primary release is reachable from any of the three GFFs (inferred from :782-813).
- **Race risk:** NoPreprocess_primary depends only on `primary_genome_RSRC` (GSF:271), not on the secondary/organelle FASTAs. If the primary genome.gff references supercontig or mitochondrial seq_ids, the load can die if it runs before those FASTAs (inferred). Partition GFFs per FASTA partition.
- **Gene IDs:** all genes from all three GFFs share one release, so IDs must be unique across partitions (inferred). `postLoadIsfQA` exists (printIsfTestingCommandsGus4:116), but I did not read it.

### 3.5 GFF3 dialect for `genemRNAExonCDS2Gus.xml` (the practical default)
- **Pipeline:**
  - Bio::Tools::GFF builds the ID/Parent tree (InsertSequenceFeatures.pm:654-741).
  - Then the preprocessor `ACD/lib/perl/genemRNAExonCDS2BioperlTree.pm` reshapes it (mapping line 8).
  - Then the skeleton maker `GusSkeletonMaker::makeGeneSkeleton` (mapping 10-11).
- **GFF3 tree rules:**
  - Children attach via `Parent`; multiple Parents are allowed (:673-675).
  - Children outside the parent span widen the parent, with a warning (:697-707).
  - Orphan children only `warn` (:736-739).
- **Top-level types kept by the preprocessor:**
  - `gene`, `protein_coding_gene`, `ncRNA_gene`, `pseudogene` (all normalised to gene; :48-57, :100).
  - Standalone `tRNA`, `rRNA`, `snRNA`, `snoRNA`. These get a synthesized `${type}_gene` with gene ID = feature ID and transcript ID = `<ID>.<type>` (:76-98).
  - `repeat_region` (+`satellite` → `microsatellite`), `STS`, `gap`, `direct_repeat`, `three_prime_utr`, `five_prime_utr`, `transposable_element`, `splice_acceptor_site` (:59-73, :198-203).
  - **Everything else at top level is silently dropped.** That includes a standalone `CDS`, `region`, `sequence_feature`, `ncRNA` / `lnc_RNA` without a gene, and capitalised `five_prime_UTR`.
- **Fatal mismatches between preprocessor and map:**
  - `STS`, `microsatellite` and `splice_acceptor_site` are passed through but have **no `<feature>` in the map**. Any of them in the input makes ISF die: "Map XML file ... does not contain a <feature name=...>" (GAF/Supported/lib/perl/BioperlFeatMapperSet.pm:26; grep of the map = 0 hits).
  - **Unknown attribute keys are fatal:** every key on a mapped feature must be listed as a `<qualifier>` (handled or `ignore="true"`), or ISF dies (GAF/Supported/lib/perl/BioperlFeatMapper.pm:135-139).
  - Gene attributes are copied onto the synthesized gene. Transcript attributes are copied onto the transcript, excluding ID, Parent and Derives_from (preprocessor :511-534).
  - The accepted key list for `coding_gene` is mapping lines 17-131; for `mRNA` it is 248-375. GenBank-style keys (`Dbxref`, `Name`, `gbkey`, `gene_biotype`, `locus_tag`, `product`, `Ontology_term`, `Note`, `protein_id`, …) are present but **ignored**.
  - **Functional data inside the GFF (product, GO, Dbxref) is NOT loaded by ISF.** It must come through the functional classes in §4.
- **Transcript typing (preprocessor :225-299):**
  - Recognised child types: `mRNA`, `transcript`, `misc_RNA`, `guide_RNA`, `siRNA`, `rRNA`, `snRNA`, `snoRNA`, `tRNA`, `ncRNA`, `lncRNA`/`lnc_RNA`, `lincRNA`, `miRNA`, `scaRNA`, `pseudogenic_transcript`, `scRNA`, `SRP_RNA` (and variants), `RNase_MRP_RNA`, `pre_miRNA`, `antisense_RNA`, `telomerase_RNA`, `V/C_gene_segment`, `primary_transcript`, `piRNA`, `circular_ncRNA`, `miRNA_primary_transcript`, `nc_primary_transcript`, `precursor_RNA`.
  - `mRNA` and `pseudogenic_transcript` become `coding` → gene type `coding_gene`, transcript type `mRNA` (:287-289, :303-319).
  - A `transcript` takes its type from the `biotype` attribute, else `gbkey`, else coding (:291-299).
  - **Hazard:** `biotype=protein_coding` yields types `protein_coding` / `protein_coding_gene`, which are not in the map, so ISF dies (inferred from map feature list + BioperlFeatMapperSet.pm:26).
  - Any mRNA under a gene makes the gene `coding_gene` (:307-315).
  - Pseudo: a gene with `pseudo`, or Note/description matching /pseudogene/, and no children becomes `pseudogene` + `pseudogenic_transcript` `<gID>.mRNA` (:112-150). An all-pseudo coding gene becomes `pseudogene` (:167-189).
- **Exon / CDS rules (:356-445):**
  - Child `exon` features define exons. Exons are rebuilt fresh, so their attributes are dropped.
  - `CDS` / `cds` / `Cds` define coding start/end per exon. CDS phase (column 8) shifts the first coding base (:407-419).
  - With no CDS on an mRNA, exons are treated as fully coding (:396-405).
  - CDS count inconsistent with exons → `die` (:440-445).
  - No exons → exons are made from the transcript location (:447-466).
  - Gene, RNA and exon must share a strand, else `die` (:487-509).
  - Duplicate exon coordinates in a gene → `die` (gus4SpecialCaseQualifierHandlers.pm:131-139).
- **ID rules:**
  - Gene `source_id` = GFF gene `ID`, with whitespace trimmed and `:pseudogene` stripped (preprocessor :160-164; handler gus4SpecialCaseQualifierHandlers.pm:101-110).
  - Exon `source_id` = `<geneId>-E<n>` (:146).
  - Transcript `source_id`: a temporary `<geneId>-T<n>` (:171-173), then the mRNA `ID` column (mapping :249), then **overwritten** from transcriptInfoAndIds (GusSkeletonMaker.pm:553-555).
  - Qualifiers are applied gene-first, then children (InsertSequenceFeatures.pm:1161-1183). So PRINT_TRANSCRIPT_IDS should emit the GFF mRNA IDs (inferred).
  - **Protein (TranslatedAAFeature/Sequence) `source_id` = `<transcriptId>-p<n>`**, only for `mRNA` under coding_gene and similar types (GusSkeletonMaker.pm:564-580). It is **never** the GFF CDS ID or the `protein_id`.
- **Validation failures:**
  - A tree that fails validators is not inserted and is logged to `validation.log` (InsertSequenceFeatures.pm:1030-1060, 1704-1745).
  - With the default `allowedValidationErrors=0`, the plugin never aborts on this count (:347-353, :1456-1460). **Bad gene models are silently dropped** (inferred: the count check is `0 && …`).
  - A translation mismatch is only logged, not counted (gus4SpecialCaseQualifierHandlers.pm:830-846; the push to validationErrors is commented out).
- **UTRs:** `three_prime_utr` and `five_prime_utr` are mapped with `ignore="true"` (mapping 2375-2394). They are not loaded.

---

## 4. Functional classes

All of these are scope=organism. Each has `name` + `version` identity props, and the path is name-driven, so multiple datasets of a class coexist when `name` differs.

### 4.1 productNames (CX:2800-2822)
- **Props:** projectName, organismAbbrev, name, version.
  - In practice (440): name `$$source$$` 192, `GenBank` 74. version `$$functAnnotVersion$$` 164, `$$genomeVersion$$` 134.
- **Unpack:** `processProductAddPreferred.pl --inputFile products.txt --outputFile processed_products.txt --assignedBy ${name}` (CX:2819).
- **Graph:** `genesAndProteins.xml:39-44` → `workflowTemplates/productNames.xml:12-22`. It runs only when `isAnnotatedGenome` is true (`postLoadGenome.xml:54`).
- **Input `products.txt`:** TSV with no header. Columns: `id, product, is_preferred, pmid, evidence_code, with, assigned_by` (ACD/bin/processProductAddPreferred.pl:26-30; plugin ACD/plugin/perl/InsertProductFromTabFile.pm:153). Only id and product are required.
  - `;` in the product is rewritten to `,` (pl:29). The dedup key is `product;pmid;evCode;with;assigned_by` split on `;` (pl:30, 66). **Semicolons in pmid, evCode, with or assigned_by would corrupt columns** (inferred).
  - is_preferred: `1`/`true` or `0`/`false`. If a gene's rows carry any flag, unflagged rows become 0. If none are flagged, the first row for an id is preferred. A single row is always preferred (pl:37-63).
  - assigned_by defaults to dataset `name` when absent; it is blanked if name contains `_DELETED_` (pl:69-74).
  - evidence_code must be a **name** resolvable in `GO_evidence_codes_RSRC` (for example `IEA`). Otherwise the load errors (plugin :236-247).
- **Target (gene vs transcript) is decided by the ID, not by name or prop:**
  - **Transcript match first**, then GeneFeature (plugin :163-181).
  - The ID map covers all `Transcript`/`GeneFeature` rows for the organism via `nasequence.taxon_id` (:356-381).
  - Products are stored with the **feature's** ext-db release, not the product dataset's (:164-165, 202).
- **Failure:** dies if more than one input line exists and fewer than 50% load (:185). Unmatched IDs only warn (:180).

### 4.2 GeneOntologyAssociations (CX:3162-3183)
- **Props:** projectName, organismAbbrev, version, name.
  - In practice (149): name `$$genomeSource$$` 31, `GeneDB` 29, `GenBank` 15. version is often a literal date (67).
  - fgra has two (MIPS, Sanger; fgra:101-113).
- **Graph:** `organismSpecificMisc.xml:167-178`, under OrganismSpecific, which runs after LoadAliases (PX:485).
- **Args (CX:3181):** `--inputFile @@dataDir@@/associations.gas --inputIdColumn id --targetTable DoTS::TranslatedAASequence --lineOfEvidence ${name} --tolerateMissingSeqs --skipBadGOTerms @@dataDir@@/badGOTerms.log`, plus the `--seqIdSql` described below.
- **Format:** GAF 2.x via CBIL Assoc.
  - **More than 13 tab columns are required** (CBIL/Bio/lib/perl/GeneAssocParser/Assoc.pm:26-46). Lines starting with `!` are skipped (plugin :231).
  - Columns used: 2 DB_Object_ID = feature ID (`inputIdColumn id`), 4 qualifier (`NOT` detected, :352), 5 GO ID, 6 reference, 7 evidence, 8 with, 15 assigned_by.
  - A non-empty col 15 **replaces** `lineOfEvidence` as the LOE name (:476-488).
- **ID resolution (`--seqIdSql`, CX:3181):**
  - Gene source_id, transcript source_id or protein source_id all map to `aa_sequence_id`.
  - The SQL is **not restricted to organism**.
  - The result is loaded into a hash, so for a gene ID with several transcripts the **last row wins**. A gene-level GO term attaches to one protein only (plugin :302-319; inferred from hash overwrite).
  - Prefer transcript or protein IDs.
- **Tolerances:**
  - Missing IDs are skipped and logged (:321-339).
  - Unknown GO IDs are written to badGOTerms.log and skipped (:378-433).
  - An unknown evidence code is a **fatal** userError. Evidence is matched against `SRes.OntologyTerm.source_id` in GO_evidence_codes_RSRC, and `NR` is mapped to `ND` (:496-513).

### 4.3 EnzymeCommissionAssociations (CX:3197-3220)
- **Props:** projectName, organismAbbrev, version, name.
  - In practice (112): name `gb` 44, `GeneDB` 34. version `$$functAnnotVersion$$` 55.
- **Graph:** `organismSpecificMisc.xml:180-190`.
- **Args:** `--ECMappingFile @@dataDir@@/ec.txt --evidenceCode "${name}" --aaSeqLocusTagMappingSql "select aa_sequence_id from dots.TranslatedAAFeature where source_id = ?"` (CX:3217).
- **Format:** **column 1 = identifier, column 2 = EC number** (GAF/Community/plugin/perl/InsertECMapping.pm:134). The plugin doc string says the reverse; the code wins.
  - Whitespace is stripped (:140-141).
- **ID must be the protein `source_id` (`<transcriptId>-p1`)** for this class. A gene ID silently matches nothing.
  - Use class `ECAssocGeneFeatureMappings` (CX:3224-3247, same path layout) for gene IDs.
- EC numbers not in `SRes.EnzymeClass` are silently skipped (:155). There is no organism scoping.

### 4.4 geneName (CX:5214-5237)
- **Props:** projectName, organismAbbrev, name, version, `genomeVersion`.
  - In practice (137): genomeVersion `$$genomeVersion$$` 137/137.
- **Graph:** `organismSpecificMisc.xml:320-331`.
- **Args:** `--file @@dataDir@@/geneName.txt --geneNameDbName '${organismAbbrev}_primary_genome_RSRC' --geneNameDbVer '${genomeVersion}' --isPreferred` (CX:5235).
- **Format:** `gene_id \t name` (ACD/plugin/perl/InsertGeneNamesFromTabFile.pm:160).
  - **Gene IDs only.** Lookup is `dots.genefeature WHERE external_database_release_id = <primary genome release>` (:292-309). Transcript IDs and IDs from a wrong genomeVersion simply don't match (warn :167).
  - Every name is marked preferred (`--isPreferred`, :152).
  - Names are stored under the **genome** release (:143-144, :192). The geneName dataset's own version is path-only.
  - There is no failure threshold.

### 4.5 dbxref_synonym (CX:1762-1786)
- **Props:** organismAbbrev, projectName, version, name.
  - In practice (57): name `GeneDB` 32.
- **Graph:** `dbXRefs.xml:43-53`, under dbXRefs, which runs after LoadAliases (PX:501).
- **Loader attr** `externalDbIdType="synonym"` sets the release's `id_type` (CX:1775, RLS:38,48).
- **Args:** `--columnSpec "primary_identifier" --viewName GeneFeature --tableName "DbRefNAFeature"`, with **no** `geneExternalDatabaseSpec` (CX:1784).
- **Format:** `gene_id \t synonym` (InsertDBxRefs.pm:216-241). Whitespace is removed from the ID (:220).
- **Gene lookup** (`GUS::Supported::Util::getGeneFeatureId`, GAF/Supported/lib/perl/Util.pm:35-112):
  - Without a spec, it searches all non-predicted GeneFeatures in the DB.
  - It also resolves via alias dbrefs (`id_is_alias = 1`), with the longest transcript winning. Preferred source_ids override.

### 4.6 comments (CX:3278-3300)
- **Props:** projectName, organismAbbrev, name, version.
  - In practice (269): name `GenBank_transcript` 161, `GeneDB_transcript` 26, `Sanger_transcript` 23, `GenBank_gene` 11, `RefSeq_*`.
- **Graph:** `organismSpecificMisc.xml:333-342`.
- **Args:** `--file @@dataDir@@/comments.txt --organismAbbrev ${org} --datasetVersion ${version}` (CX:3298).
- **Format:** `source_id \t comment [\t comment_date]` (ACD/plugin/perl/InsertNaFeatCommentFromTabFile.pm:165).
  - When comment_date is missing, it is the dataset version if `yyyy-mm-dd`, else the file mtime (:170-177).
- **Target is decided by ID match, not by the `_gene` / `_transcript` suffix:**
  - **GeneFeature is tried first**, then Transcript, both scoped by `row_project_id` (:167-195).
  - The `name` suffix is only a naming convention, used for uniqueness and the path.
- **Failure:** dies if 0 rows load (:200).

### 4.7 aliases (CX:1793-1827)
- **Props:** projectName, organismAbbrev, version, name, columnSpec, url, urlUsesSecondaryId, target (`NASequence|AAFeature|NAFeature`), idType (`previous id|alternate id`), viewName.
  - In practice (546): target NAFeature 481 / NASequence 65. viewName GeneFeature 244 / Transcript 237 / ExternalNASequence 66. columnSpec always `primary_identifier`. name `gbProteinId` 224, `PreviousGeneIDs` 75.
- **Loader attrs** `externalDbIdType="${idType}" externalDbIdIsAnAlias="true"` set `id_type` and `id_is_alias` on the release (CX:1811-1812, RLS:38-39).
- **Graph:** `workflowTemplates/aliases.xml:19-31` (subgraph `${name}_${target}_aliases_RSRC`). `makeGeneAliasesDownloadFile` waits on `*_NAFeature_aliases_RSRC` (:45).
- **Format:** `current_source_id \t alias` (InsertDBxRefs.pm:216-241).
  - An alias that is itself a current GeneFeature source_id is **skipped**. This triggers because extDbName contains "aliases" (:226-235).
  - viewName drives lookup (:305-314, :360-387):
    - `GeneFeature` → getGeneFeatureId (alias-aware, cross-DB).
    - `Transcript` → `dots.Transcript` source_id (all organisms; last wins).
    - `ExternalNASequence` → `ExternalNASequence ∪ VirtualSequence`.
- **Uniqueness:** `name` + `target`.

### 4.8 dbxref_simple (CX:1665-1696)
- **Props:** projectName, organismAbbrev, name, version, columnSpec, target, url (CDATA, `EXTERNAL_ID_HERE` placeholder), urlUsesSecondaryId, genomeVersion, viewName.
  - In practice (606 in 304 files): genomeVersion `$$genomeVersion$$` 606/606. columnSpec `primary_identifier` 599. target NAFeature 601. viewName GeneFeature 373 / Transcript 231. urlUsesSecondaryId `false` 606.
- **Loader attr** `externalDbIdUrl` / `externalDbIdUrlUseSecondaryId` sets the release `id_url` or `secondary_id_url` (CX:1685-1688, RLS:42-48).
- **Args:** `--DbRefMappingFile @@dataDir@@/mapping.txt --columnSpec "${columnSpec}" --tableName DbRef${target} --viewName "${viewName}" --geneExternalDatabaseSpec '${org}_primary_genome_RSRC|${genomeVersion}'` (CX:1694).
- **Format:** col 1 = feature or sequence `source_id`. Cols 2..n map in order to `columnSpec` fields of `SRes.DbRef` (`primary_identifier`, `secondary_identifier`, `lowercase_secondary_identifier`, `remark`; InsertDBxRefs.pm:237-241). Values are trimmed. Unmatched IDs are skipped and logged (:315-318).
  - With viewName GeneFeature, lookup is restricted to the genome release (Util.pm:56-83), so genomeVersion must match.
  - With viewName Transcript, lookup is cross-organism (Util.pm:153-170).
- **Coexistence:** everything is name-driven. datasetName is `${org}_dbxref_${name}_RSRC` (CX:1680), the path is `dbxref/${name}/${version}` (CX:1689) and the subgraph is `dbxref_${name}_RSRC` (`dbXRefs.xml:22`). Any number can coexist with distinct `name`; `version` is independent per dataset.
  - Convention: `*_from_annotation` (pmid, pdb, uniprot, rfam, pfam, merops, cazy, …) for xrefs harvested from the GFF (fgra:155-192).
- Because dbXRefs runs after LoadAliases (PX:501) and gene lookup is alias-aware (Util.pm:44-56), dbxrefs keyed by old gene IDs still resolve (inferred).

---

## 5. Organism-level requirements

### 5.1 Organism dataset (project.xml, e.g. `FungiDB.xml:9059-9086`)
- **Props:** declared at CX:65-94 and consumed by the PX organism template at PX:91-117.
- **Constants that must agree with the per-organism file:**
  - `organismAbbrev`.
  - `ncbiTaxonId` and `strainAbbrev`: compared at load by validateOrganismInfo, §5.2.
  - `genomeVersion`: must equal the fasta_primary `version`. It builds `genomeExtDbRlsSpec` for every downstream graph (PX:196, 312, 445, 456, 475, 500).
  - `genomeSource`: passed to InsertOrganism (`loadGenome.xml:52`) and organelle web-service files. It is conventionally also the FASTA `name` (`$$genomeSource$$`).
- **`isAnnotatedGenome=true`** is required for products, protein extraction and genesAndProteins (`postLoadGenome.xml:54`, `loadGenome.xml:93`).
- **`isNotEbiGenome=true`** for non-EBI loads (fgra uses true).
  - It switches dust and masking to in-workflow Nextflow (`dust.xml:56-66`).
  - It **skips** `calcProteinAttributes` (`genesAndProteins.xml:27`, `includeIf="!$$isNotEbiGenome$$"`).
- **`annotationIncludesTRNAs`:** true skips tRNAscan (`genome.xml:31`).
- The organism loader (`${org}_RSRC`, LoadNothing) exists only for prop plumbing (CX:97-110).

### 5.2 validateOrganismInfo (CX:117-126)
- **Props:** organismAbbrev, strainAbbrev, projectName, ncbiTaxonId.
  - Practice also passes speciesNcbiTaxonId and genomeVersion (839/839; fgra:19-26). Those are not class props, and the template ignores them (GSF:17-20).
- **Step:** `ValidateOrganismInfo.pm:9-28` errors unless `strainAbbrev` and `ncbiTaxonId` equal the ApiDB.Organism row written by insertOrganism from the project.xml organism dataset.
- There is no datasetLoader, so nothing is delivered.

---

## 6. Dependency checklist for a generator

1. **FASTA partitions:**
   - Primary = top-level nuclear type.
   - Secondary = one per lower soTerm, with `name` equal to the matching features `name`.
   - Organelle = one per soTerm, with `name` equal to the matching features `name`.
   - Sequence IDs must be globally unique across partitions (a duplicate is silently skipped, §2.1).
2. Every GFF3 `seq_id` must exist in the primary release before that GFF loads. Split the GFF per partition (§3.4).
3. Each features `final/` needs `genome.gff` + `transcriptInfoAndIds` (+ `chromosomeMap.txt` for doc parity).
4. GFF attribute keys must be a subset of the mapping's qualifier lists. Feature types must survive the preprocessor and exist in the map (§3.5).
5. **Functional file IDs:**
   - products: transcript or gene ID.
   - comments: gene or transcript ID.
   - geneName and synonyms: gene ID.
   - GO: gene, transcript or protein, but use transcript or protein for precision.
   - EC (this class): **protein `<transcriptId>-p1`**.
   - aliases / dbxref: per `viewName`.
6. Version and constant invariants are in §0.2.

---

## 7. Open questions / couldn't determine

- **`%PARENT_DATASET_VERSION%` / `%DATASET_NAME%` substitution:** the code was not found in local repos (likely the GUS/ReFlow DatasetLoader). Resolution to the parent loader's `version` is inferred from RLS:26-31.
- **Unknown or extra `<prop>`s** (e.g. `organelle` on NoPreprocess_organelle, `speciesNcbiTaxonId`/`genomeVersion` on validateOrganismInfo): I could not find the dataset→graph generator that would reject or ignore them. They exist in production, so they are tolerated (inferred).
- **Transcript `source_id` in PRINT_TRANSCRIPT_IDS output:** whether it equals the GFF mRNA ID (via mapping `column="source_id"`) or the temporary `<gene>-T<n>` depends on qualifier ordering in ISF. I inferred gene-first then children (InsertSequenceFeatures.pm:1161-1183), which yields the GFF ID. This needs a test run.
- **Whether `transcriptInfoAndIds` can be generated without a GUS DB.** Its key needs transcript sequence (genome + exon coords) and exon order numbers as assigned by `makeGeneSkeleton` (not read). Reimplementing it outside GUS is plausible but unverified.
- **`GO_evidence_codes_RSRC` term spelling:** the GO plugin matches evidence against `OntologyTerm.source_id`, while products match by `name` via OntologyLookup. Whether both accept bare `IEA` depends on how that ontology is loaded. I didn't query the DB.
- **Bio::Tools::GFF details:** handling of `##FASTA`, `##sequence-region`, URL-escaped attributes and multi-value attributes was not verified (BioPerl not local).
- **Hidden attribute keys:** `CDSLength` on mRNA is consumed by validateCodingSequenceLength (gus4SpecialCaseQualifierHandlers.pm:704-720). Which preprocessor sets it for GFF input was not traced.
- **`postLoadIsfQA` checks** (referenced by printIsfTestingCommandsGus4:116) were not read. It may impose additional post-load gates.
- **Other ISF maps:** `geneDBGFF2Gus.xml`, `geneOnly2Gus.xml` and `genemRNAExonCDSTranscript2gbkey2Gus.xml` were not analysed. §3.5 covers only `genemRNAExonCDS2Gus.xml`.
- **fgraPH-1 single GFF:** fgraPH-1 loads secondary and organelle FASTAs but only a primary features dataset. I couldn't confirm from the repo whether its genome.gff carries features on those sequences (which would rely on load timing) or omits them.
- **`--soTermName` vs declared `SOTermName`:** the case-insensitive option match in GUS PluginMgr is assumed, not read.
