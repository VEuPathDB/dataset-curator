# Trial ISF spike: E. cuniculi GB-M1 (GCA_000091225.2) against UniDB_shu_m

Date: 2026-11-04. Scratch root used below: `$S = /tmp/claude-1000/-home-jbrestel-workspaces-src-dataset-curator/ced1fc7e-1f97-409e-b92a-5699b2db294d/scratchpad`.

**Outcome:** a trial ISF (PRINT_TRANSCRIPT_IDS, no `--commit`) loaded 2196 gene models and produced `transcriptIds`. A second run used the class's real `SET_TRANSCRIPT_IDS` args (also without `--commit`) and read that file back as `final/transcriptInfoAndIds` (result in §3.4). No missing-reference-data failure happened, because UniDB_shu_m already has every global table the trial reads. The seed list in §2 comes from table-access statistics, not from failures. All real failures were toolchain or GFF-shape problems (§6).

---

## 1. Working recipe

### 1.1 Container (derived image `curator-trial-isf:spike-unidb`, local only)

`$S/trialIsfImage/Dockerfile` (built with context `ApiCommonData/Load`; the repo is only read):

```dockerfile
FROM veupathdb/gus-apidb-base:1.2.12
RUN apt-get update && apt-get install -y --no-install-recommends libbio-perl-perl && apt-get clean
# base image GusAppFramework (bca3334, 2023) ISF does not compile on perl 5.38
ARG GUS_COMMIT=1032fbf33754da71ee8657100c6a440f2924a41a CBIL_COMMIT=81061b102a5df29cc2230c4758eeaf8e8922f5a7
RUN cd $PROJECT_HOME && rm -rf GUS CBIL \
 && git clone -q https://github.com/VEuPathDB/GusAppFramework.git GUS && git -C GUS checkout -q $GUS_COMMIT \
 && git clone -q https://github.com/VEuPathDB/CBIL.git && git -C CBIL checkout -q $CBIL_COMMIT \
 && bld CBIL && bld GUS/PluginMgr && bld GUS/Supported && bld GUS/Community
# = install/build.xml defaultComponentInstall for ApiCommonData/Load, minus the
#   FgpUtil/TuningManager/DoTS imports that `bld ApiCommonData` would require
COPY bin/ ${GUS_HOME}/bin/
COPY lib/xml/ ${GUS_HOME}/lib/xml/
COPY lib/perl/ ${GUS_HOME}/lib/perl/ApiCommonData/Load/
COPY plugin/perl/ ${GUS_HOME}/lib/perl/ApiCommonData/Load/Plugin/
RUN chmod -R +x ${GUS_HOME}/bin
```

```bash
cd ApiCommonData/Load && docker build -t curator-trial-isf:spike -f $S/trialIsfImage/Dockerfile .
# then regenerate GUS::Model objects against the target DB (§6, failure 3) and snapshot:
docker run --name gusModelGen --network host -v $S/trialIsfImage/gus.config:$GUS_HOME/config/gus.config:ro \
  curator-trial-isf:spike bash -c 'rm -rf $GUS_HOME/lib/perl/GUS/Model && bld GUS/Model'
docker commit gusModelGen curator-trial-isf:spike-unidb && docker rm gusModelGen
```

The minimum for ApiCommonData is a file copy, not `bld`. ISF needs only `lib/perl` (preprocessor, GusSkeletonMaker, qualifier handlers), `lib/xml/isf` (the map) and `bin/preprocessGFF3`.

### 1.2 gus.config (`$S/trialIsfImage/gus.config`, mode 600, mounted read-only)

It starts from the image's template, with these keys changed:

```
dbVendor=Postgres
dbiDsn=dbi:Pg:dbname=UniDB_shu_m;host=localhost;port=5432
jdbcDsn=jdbc:postgresql://localhost:5432/UniDB_shu_m
databaseLogin=jbrestel
databasePassword=<from $PGPASSWORD>
userName=dba        # must exist in core.userinfo
group=UniDB         # must exist in core.groupinfo
project=UniDB       # must exist in core.projectinfo
```

### 1.3 Command sequence

```bash
GA="docker run --rm --network host -u $(id -u):$(id -g) -e HOME=/tmp \
  -v $S/trialIsfImage/gus.config:/opt/veupathdb/gus_home/config/gus.config:ro \
  -v $S/trialRun:/work -w /work curator-trial-isf:spike-unidb"
DB=curatorTrial_ecunGB-M1_primary_genome_RSRC; V=2017-03-09
SEQ=/work/ecunGB-M1_primary_genome_RSRC; FEAT=/work/ecunGB-M1_primary_genome_features_RSRC

# --- sequence dataset (writes) ---
$GA ga GUS::Supported::Plugin::InsertExternalDatabase    --name $DB --commit
$GA ga GUS::Supported::Plugin::InsertExternalDatabaseRls --databaseName $DB --databaseVersion $V --commit
$GA ga GUS::Supported::Plugin::LoadFastaSequences --externalDatabaseName $DB --externalDatabaseVersion $V \
  --ncbiTaxId 284813 --sequenceFile $SEQ/final/genome.fasta --chromosomeMapFile $SEQ/final/chromosomeMap.txt \
  --soTermName chromosome --SOExtDbRlsSpec 'SO_RSRC|%' --regexSourceId '^>(\S+)' \
  --tableName DoTS::ExternalNASequence --commit

# --- GFF preprocessing (host + container, no DB) ---
python3 -I $S/scripts/normalizeNcbiGenbankGffForIsf.py <ncbi>.gff $FEATHOST/work/genome.normalized.gff3
sed -E -e 's/;is_ordered=true//' -e '/\tgap\t/s/;gbkey=gap//' genome.normalized.gff3 > genome.normalized.stripped.gff3
$GA preprocessGFF3 --input_gff $FEAT/work/genome.normalized.stripped.gff3 --output_gff $FEAT/final/genome.gff

# --- trial ISF: class pluginArgs, PRINT_TRANSCRIPT_IDS, NO --commit ---
$GA ga GUS::Supported::Plugin::InsertSequenceFeatures --extDbName $DB --extDbRlsVer $V \
  --mapFile /opt/veupathdb/gus_home/lib/xml/isf/genemRNAExonCDS2Gus.xml \
  --inputFileOrDir $FEAT/final/genome.gff --inputFileExtension gff \
  --chromosomeMapFile $SEQ/final/chromosomeMap.txt --fileFormat gff3 --soExtDbSpec 'SO_RSRC|%' \
  --defaultOrganism 284813 --seqSoTerm chromosome \
  --validationLog $FEAT/trial/validation.log --bioperlTreeOutput $FEAT/trial/bioperltree.out \
  --seqIdColumn source_id --naSequenceSubclass ExternalNASequence \
  --postprocessingDirective PRINT_TRANSCRIPT_IDS --postprocessingDir $FEAT/trial/
cp $FEAT/trial/transcriptIds $FEAT/final/transcriptInfoAndIds
```

The `chromosomeMap.txt` was built from the FASTA deflines (`acc \t roman numeral \t order`).

GFF preprocessing has three layers. Layers 1 and 2 were needed for this genome and are probably needed for most NCBI GenBank GFFs.

1. **`normalizeNcbiGenbankGffForIsf.py`** (spike script, `$S/scripts/`):
   - strips the `gene-` prefix from gene IDs;
   - collapses split gene lines;
   - for gene→CDS models (NCBI GenBank style, no mRNA), adds an mRNA `rna-<geneId>` (with an NCBI-style `-2` suffix when the ID collides), reparents the CDS to it and adds one exon per CDS segment.
2. **Strip attributes the map does not list:** `is_ordered` on gene, and `gbkey` on gap.
3. **`preprocessGFF3`** (ApiCommonData): rewrites `key=value` into GFF2-style `key "value";`. It also URL-decodes and splits Dbxref values. **This step is mandatory** (§6, failure 4).

---

## 2. Seed requirements

Method: I diffed `pg_stat_user_tables` (seq_scan / idx_scan / n_tup_ins) before and after the trial ISF runs (the diff covers two runs: one that failed partway and the successful one). Every table the trial read is listed below. No `apidb.*` table was touched; in particular `apidb.organism` is not needed (ecun has no row and the trial succeeded).

| Item | Global / per-organism | Loaded by | Source | What fails without it |
|---|---|---|---|---|
| `core.userinfo` / `groupinfo` / `projectinfo` rows that match gus.config `userName`/`group`/`project` | global | GUS install (`installApidbSchema` / initial DB build); no ga plugin used here | GUS bootstrap | Every `ga` call fails in openInvocation (not reproduced; GUS PluginMgr behaviour) |
| `core.databaseinfo`, `core.tableinfo`, `core.databaseversion` **that match the GUS::Model objects in the image** | global (schema) | schema install | GusSchema + ApidbSchema | Every `ga` call dies with `Invalid child name for Table ...AlgorithmInvocation_Table: 'GUS::Model::ApidbUserDatasets::AnnotationProperties'` (reproduced, §6 failure 3) |
| `core.algorithm`, `algorithmimplementation`, `algorithmparamkey`, `algorithmparamkeytype` | global | ga registers them automatically. This spike created ISF implementation row 210 because the plugin md5 was new | none | n/a (auto) |
| `sres.externaldatabase` + release `SO_RSRC` and its `sres.ontologyterm` rows (2597 here). Needs at least `chromosome` (FASTA) and the SO names the map/skeleton use (gene, mRNA, exon, tRNA, rRNA, snRNA, snoRNA, transcript, ...) | global | `InsertSequenceOntologyOBO` (GUS::Supported), or the ontology loader used for SO_RSRC | so.obo | LoadFastaSequences/ISF cannot resolve SO terms (the plugin errors at :757-791). Not reproduced: SO was present |
| `sres.taxon` row for ncbi_tax_id 284813 (`taxonname` was not read by ISF) | per-organism row, usually loaded globally | `GUS::Supported::Plugin::LoadTaxon` (NCBI taxdump), or the taxonomyPatch_* loader for missing taxa | NCBI taxonomy | LoadFastaSequences `--ncbiTaxId` and ISF `--defaultOrganism` lookups fail. Not reproduced |
| `sres.geneticcode` (+ `sres.taxon.genetic_code_id` for the organism) | global table, per-organism FK | NCBI taxdump load (`gencode.dmp`) with the taxonomy | NCBI taxonomy | Translation of every coding transcript (2583 seq scans, one per protein). A null or missing code would break the translated AA sequence. Not reproduced |
| `<org>_primary_genome_RSRC` ext db + release | **per-organism** | `InsertExternalDatabase`, `InsertExternalDatabaseRls` | dataset XML | ISF dies looking up the release |
| `dots.externalnasequence` rows for every GFF seq_id, in that release | **per-organism** | `LoadFastaSequences` (fasta_primary args) | genome.fasta | ISF dies on a missing seq_id (InsertSequenceFeatures.pm:793-813). These rows are the real input to `transcriptSeq` |
| GO, EC, products, `apidb.organism`, NRDB, InterPro, ... | not needed | n/a | n/a | n/a |

**Implication:** the seed for a trial-ISF DB is the GUS/ApiDB schema, the core user/group/project rows, SO_RSRC, and NCBI taxonomy + genetic codes. Everything per-organism is created by the trial itself (ext db, release, FASTA). The large data in UniDB_shu_m (GO, the other organisms, 64k ontology terms) is not needed.

---

## 3. transcriptInfoAndIds

### 3.1 Head (sequence truncated for display)

```
ECU08_0010	ATGAGGCGGATCTATGCAGCATGGACGCTA...(996bp)	1	748,1743	rna-ECU08_0010
ECU08_0020	ATGGGTATCATAGACGTCCAGAGGTCTCAT...(831bp)	1	2386,3216	rna-ECU08_0020
ECU08_0030	ATGGGTAGTGTGCATGGTTGGATTGCTTGG...(1860bp)	1	3463,5322	rna-ECU08_0030
ECU08_0950	...	1,2,3	107942,108119,108144,108450,108476,108926	rna-ECU08_0950
```

### 3.2 Columns (GusSkeletonMaker.pm `printTranscriptIds`, 5 tab-separated columns, no header)

1. gene `source_id` (the GFF gene ID after preprocessing)
2. transcript feature sequence, with `[^ATCG]`→`N`, computed from the loaded genomic sequence plus exon coordinates
3. exon order numbers, sorted and comma-joined (`1`, `1,2,3`)
4. all exon start and end coordinates, sorted numerically and comma-joined (genomic, 1-based)
5. transcript `source_id`

Rows appear in feature-tree order, and sequences are processed in Perl hash order. Chromosome VIII came first in this run, so the row order is not stable.

### 3.3 Confirmations
- **Transcript IDs equal the GFF RNA IDs:** all 2159 gene-parented RNA IDs in the final GFF (2126 synthesized `rna-ECU…` mRNAs + 33 NCBI tRNA/rRNA/snRNA) appear verbatim in column 5. This resolves the reference doc's §7 open question: the mapping's `source_id` qualifier wins over the temporary `<gene>-T<n>`.
- The remaining 37 IDs come from parentless tRNA/rRNA/snRNA/snoRNA. The preprocessor gives each one a gene ID equal to the feature ID (`rna-AL391737.2:129509..129700`) and a transcript ID of `<ID>.<type>` (`rna-AL391737.2:129509..129700.snoRNA`). These IDs are coordinate-derived and ugly. A preprocessing step should assign locus-style IDs before the trial.
- **No GUS primary keys:** every column comes from `getSourceId`, `getOrderNumber`, NALocation coordinates or sequence. Nothing comes from `*_id` columns. The file depends only on GFF + FASTA plus the exon numbering in `makeGeneSkeleton`. It does not depend on the DB contents beyond the loaded sequence, so it is reproducible on any seed DB that has the same FASTA loaded.
- One gene ID per row is unique (2196 genes, 2196 rows, 0 duplicate transcript IDs).

### 3.4 Round trip: SET_TRANSCRIPT_IDS (no `--commit`)
Passed: invocation 7328 ran the class pluginArgs verbatim (`--postprocessingDirective SET_TRANSCRIPT_IDS --postprocessingDir final/`) on the same `final/genome.gff` with the copied `final/transcriptInfoAndIds`. It finished with exit 0, no "Can not find the generated transcript ID" errors, and the same 2196 trees. The PRINT output is therefore a valid SET input when the GFF, FASTA and code are unchanged between the two runs.

---

## 4. Feature counts

| | Raw NCBI GFF | Loaded (trial) |
|---|---|---|
| gene lines / unique gene IDs | 2162 / 2160 (ECU10_0805 split over 3 lines) | n/a |
| protein_coding genes (gene→CDS, **0 mRNA** in the file) | 2126 | 2126 coding_gene / mRNA (after mRNA synthesis) |
| gene-parented tRNA / rRNA / snRNA genes | 24 / 7 / 2 | 33 |
| parentless tRNA / rRNA / snRNA / snoRNA | 22 / 2 / 3 / 10 | 37 (synthesized `${type}_gene`) |
| parentless ribozyme, RNase_MRP_RNA, SRP_RNA | 3 | **0, silently dropped** |
| gene_biotype=other with no children (ECU06_0700) | 1 | **0, silently dropped** |
| **total genes** | 2196 loadable + 4 dropped | **2196** (= rows in transcriptIds) |

Rows inserted, then rolled back, by the trial: NAFeature 8041, NALocation 8041, RNAFeatureExon 2708, AAFeatureExon 2625. AASequence was 2583, but those counts include the partial failed run.

**Silent drops and silent corruption:**
- Without mRNA synthesis, **all 2126 protein-coding genes would be dropped silently**. `traverseSeqFeatures` only accepts RNA-typed children, so a gene with only CDS children returns nothing.
- Without exon synthesis, a 2-CDS gene loads as **one exon spanning the intron**. The only trace is an "internal stop codons" warning in `validation.log`; it is not an error. A 3+-CDS gene dies ("double check the number of CDS ... not consistent with the exon number"). The difference comes from an off-by-one in the `$#codingStartAndEndPairs > 0` check. Earlier trial run 2 showed this as internal-stop warnings for rna-ECU07_0355/1005/1460/1710.

---

## 5. Timings, invocation IDs, external DB rows

| Step | Wall time |
|---|---|
| Derived image build (BioPerl + GUS/CBIL clone + bld + ApiCommonData copy) | 2m35s (base image already local) |
| `bld GUS/Model` against UniDB_shu_m + commit | ~50s |
| InsertExternalDatabase / Rls | ~3s / ~4s |
| LoadFastaSequences (11 chromosomes, 2.5 Mb) | ~10s |
| GFF preprocessing (python + preprocessGFF3) | <5s |
| **Trial ISF, PRINT_TRANSCRIPT_IDS (2196 genes)** | **20m49s (~0.57 s/gene)** |
| ISF SET_TRANSCRIPT_IDS, no commit | 20m51s (exit 0) |

ISF throughput is the dominant cost. At ~0.57 s/gene, a 6k-gene genome takes about 1 h and a 15k-gene genome about 2.4 h of trial run. While sampling the session I repeatedly saw `select name, ontology_term_id from SRES.ontologyterm where external_database_release_id=5` (a full SO release fetch), which suggests an OntologyLookup is rebuilt per feature tree. I have not profiled it.

**Committed rows created (left in place, as authorized):**

| What | ID |
|---|---|
| `sres.externaldatabase` `curatorTrial_ecunGB-M1_primary_genome_RSRC` | external_database_id **465** |
| `sres.externaldatabaserelease` version `2017-03-09` | external_database_release_id **494** |
| `dots.externalnasequence` (11 chromosomes) | in release 494, row_alg_invocation_id 7322 |
| `core.algorithmimplementation` for ISF (auto-registered, new md5) | 210 |

**Algorithm invocations:**

| id | plugin | result |
|---|---|---|
| 7319 | InsertExternalDatabase | SUCCESS |
| 7320 | InsertExternalDatabaseRls | SUCCESS |
| 7321 | LoadFastaSequences | FAILED (missing `--SOExtDbRlsSpec`, no rows) |
| 7322 | LoadFastaSequences | SUCCESS |
| 7323-7328 | InsertSequenceFeatures trial / round-trip runs | not committed (`commit off`), so these invocation rows do not exist in the DB. IDs were consumed from the sequence |

No genes, transcripts or proteins are committed: `dots.genefeature` for release 494 has 0 rows.

---

## 6. Failures, dead ends, open questions

### Failures hit (in order)
1. **The base image's ISF does not compile.** GUS bca3334 (2023) uses `%$seqcount->{'A'}` (InsertSequenceFeatures.pm:885), which perl 5.38 rejects with "Can't use a hash as a reference". Fix: rebuild GusAppFramework at master 1032fbf. The `gus-apidb-base` image needs a GUS bump before any ISF use.
2. **No BioPerl in the base image.** Fix: `apt install libbio-perl-perl` (1.7.8).
3. **The image's GUS::Model objects do not match the DB schema.** The image objects were generated from a template DB that has ApidbUserDatasets/hmdb/TESS/PROT; UniDB_shu_m does not. Every `ga` call dies in openInvocation. Fix: `bld GUS/Model` against the target DB (generateGusObjects reads core.tableinfo). **The image and the seed DB must be built as a pair.**
4. **BioPerl 1.7.8 parses ISF's GFF3 as GFF2.** ISF passes `-gff_format => 3` to `Bio::Tools::GFF->new`, but BioPerl only reads `-gff_version`, so it defaults to 2. Every `key=value` attribute is lost, which shows up as "Feature gene does not have tag: ID". `preprocessGFF3` fixes this: it rewrites attributes to GFF2-style `key "value";`, and ISF then nests by ID/Parent. Any GFF fed to a NoPreprocess class therefore has to be preprocessGFF3 output.
5. **LoadFastaSequences without `--SOExtDbRlsSpec`:** "Database specifier '' is not in 'name|version' format". The current classes.xml (fasta_primary, CX:846) passes `--SOExtDbRlsSpec 'SO_RSRC|%'` and `--soGusConfigFile @@workflowRootDataDir@@/${projectName}/${projectName}_gus.config`. The reference doc's arg list is stale on this. NoPreprocess ISF args also carry `--soGusConfigFile`, so production SO lookups can hit a *different* DB from the load target.
6. **NCBI GenBank GFF has no mRNA** (gene→CDS). Without synthesis, every protein-coding gene is silently dropped (§4).
7. **Synthesized ID collision:** NCBI already used `rna-ECU11_0375` for a tRNA (its gene is `gene-ECU11_0375-2`). My first `rna-<gene>` mRNA collided, and the preprocessor died with "gene, rna, and exon are not on the same strand". Fix: suffix on collision.
8. **Split gene plus missing exons:** ECU10_0805 (3 gene lines, 3 CDS) died with "double check the number of CDS ... not consistant with the exon number". Fix: collapse the gene lines and emit one exon per CDS.
9. **Strict attributes:** `<feature name="gap"> does not have a <qualifier> for 'gbkey'`. A static check against the map also flags `is_ordered` on coding_gene. Fix: strip them. **This check is lazy:** it fires only when ISF reaches the feature, which was 4.5 minutes into the run in this spike. A pre-flight lint (GFF keys vs map qualifiers, after the preprocessor's type renames) would catch it in seconds.

### Dead ends / non-issues
- `addmRNAFeat2gff3.pl` (ApiCommonData) assumes a CDS-only GFF. It would re-parent ncRNA exons onto fake mRNAs, so it does not fit NCBI GFFs that mix ncRNA genes in.
- `bld ApiCommonData` requires FgpUtil, TuningManager and DoTS checkouts (build.xml imports). Copying the four Load directories is enough for ISF.
- Trial ISF without `--commit` leaves no rows and no algorithm invocation. It does insert rows inside a transaction and consumes sequence values, and it auto-commits a new `core.algorithmimplementation` row when the plugin md5 is new.
- **The output file is written even on failure:** `transcriptIds` is streamed per gene, and a died run leaves a partial file (563 rows in failed run 3). The caller must check the `ga` exit status (255 on failure, 0 on success) and not just the file's existence.

### Open questions
- Which BioPerl does production run? If it is 1.7.x, preprocessGFF3 is load-bearing. If it is an old fork where `-gff_format` works, the curator's preprocessing contract differs. Worth asking the data-loading team.
- The per-tree OntologyLookup reload (if that is what the repeated SO query is) is the throughput ceiling. Is a long trial acceptable, or should transcriptInfoAndIds be computed outside GUS? §3.3 shows it is a pure function of GFF + FASTA + `makeGeneSkeleton` exon numbering, so it can be reimplemented, but it must match byte-for-byte or SET_TRANSCRIPT_IDS dies.
- Gene/transcript ID policy (locus tag vs NCBI `gene-` IDs, `rna-` vs VEuPathDB `-t<build>_1`) is a curator decision, not something ISF enforces. Column 5 is whatever the GFF says.
- The validation.log stayed empty on the successful run. I did not confirm whether ISF flushes it only on certain paths.
- Parentless ribozyme / RNase_MRP_RNA / SRP_RNA, and genes without children, vanish with no log line. A pre-flight report of dropped features is needed.

### Files
- Image: `$S/trialIsfImage/Dockerfile`, build log `$S/trialIsfImage/build.log`, gus.config `$S/trialIsfImage/gus.config` (contains the password, mode 600)
- Downloads (untrusted): `$S/ncbiDownload/`
- Scripts: `$S/scripts/normalizeNcbiGenbankGffForIsf.py` (final), `$S/scripts/addMrnaToNcbiGenbankGff.py` (superseded)
- Dataset dirs: `$S/trialRun/ecunGB-M1_primary_genome_RSRC/final/`, `$S/trialRun/ecunGB-M1_primary_genome_features_RSRC/{work,final,trial,setCheck}/`
- Logs: `$S/trialRun/logs/` (isfTrial1-5, isfSetTranscriptIdsNoCommit, pgStatBefore/After)

