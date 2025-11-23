# Development Plan: curate-bulk-rnaseq Skill

> **Status**: In Development
> **Created**: 2025-11-23
> **Delete this file after implementation is complete**

## Overview

This to-be-implemented skill helps curators process bulk RNA-seq datasets for VEuPathDB. The entry point is an NCBI BioProject ID (e.g., `PRJNA1018599`).

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SRA metadata fetch | ENA Portal API + BioSample API (with manual CSV fallback) | No CLI installation required |
| MINiML XML | Auto-fetch if GEO-linked | Reduces curator effort |
| PDF support | Deferred to TODO.md | Simplify initial implementation |
| Presenter/Contacts XML | veupathdb-repos (like genome assembly) | Consistent with existing workflow |
| Other outputs | delivery/bulk-rnaseq/{BioProjectID}/ | Non-git-managed delivery area |

---

## Directory Structure

```
skills/curate-bulk-rnaseq/
├── SKILL.md                        # Main skill definition with workflow overview
├── TODO.md                         # Future enhancements (PDF support, etc.)
├── DEV-PLAN.md                     # THIS FILE - delete after implementation
├── scripts/
│   ├── fetch-sra-metadata.js       # ENA Portal + BioSample APIs → merged JSON
│   ├── fetch-miniml.js             # Find GEO series from BioProject, fetch MINiML
│   ├── generate-presenter-xml.js   # Generate RNA-seq presenter XML
│   ├── generate-analysis-config.js # Generate analysisConfig.xml
│   ├── generate-samplesheet.js     # Generate samplesheet.csv
│   ├── check-repos.sh              # (synced from shared)
│   └── check-delivery-dirs.sh      # (synced from shared - NEW)
└── resources/
    ├── step-1-fetch-metadata.md    # Fetching SRA + BioSample + MINiML
    ├── step-2-analyze-samples.md   # Claude analyzes factors, generates annotations
    ├── step-3-curate-contacts.md   # Contact curation (similar to genome assembly)
    ├── step-4-generate-presenter.md # Presenter XML generation
    ├── step-5-generate-outputs.md  # Delivery files (configs, samplesheet)
    ├── editing-large-xml.md        # (synced from shared)
    └── valid-projects.json         # (synced from shared)
```

### New Shared Files

```
shared/scripts/check-delivery-dirs.sh   # NEW - creates delivery/bulk-rnaseq/ if needed
```

### .gitignore Addition

```
delivery/
```

---

## API Research Summary

### 1. ENA Portal API (Primary for Run Metadata)

**Endpoint**: `https://www.ebi.ac.uk/ena/portal/api/search`

**Example query**:
```bash
curl "https://www.ebi.ac.uk/ena/portal/api/search?result=read_run&query=study_accession=PRJNA1018599&fields=run_accession,sample_accession,sample_alias,experiment_title,library_layout,library_strategy,library_source,library_selection,instrument_model,read_count,base_count&format=json"
```

**Returns**: JSON array with run-level metadata

**Key fields available**:
- `run_accession` (SRR...)
- `sample_accession` (SAMN...)
- `sample_alias`, `sample_title`, `experiment_title`
- `library_strategy`, `library_source`, `library_selection`, `library_layout`
- `instrument_platform`, `instrument_model`
- `read_count`, `base_count`
- `scientific_name`, `tax_id`

**Limitation**: Does NOT include custom sample attributes (infection, tissue, etc.)

### 2. NCBI BioSample API (For Custom Sample Attributes)

**Endpoint**: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi`

**Example query**:
```bash
curl "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=biosample&id=SAMN37446236,SAMN37446237&retmode=xml"
```

**Returns**: XML with `<Attributes>` containing custom fields like:
```xml
<Attribute attribute_name="infection">Babesia infected</Attribute>
<Attribute attribute_name="tissue">hemolymph</Attribute>
<Attribute attribute_name="cell type">hemocyte</Attribute>
```

### 3. GEO/MINiML Fetching

**Step 1**: Find GEO series linked to BioProject
```bash
# Search GEO DataSets for BioProject
curl "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gds&term=PRJNA1018599[BioProject]&retmode=json"
```

**Step 2**: Get GEO series accession (GSE...) from results

**Step 3**: Download MINiML
```bash
curl -L "https://ftp.ncbi.nlm.nih.gov/geo/series/GSEnnn/GSE######/miniml/GSE######_family.xml.tgz" | tar -xzO
```

### 4. Fallback: Manual SRA Run Selector CSV

If API fetching fails, curator can:
1. Go to https://www.ncbi.nlm.nih.gov/Traces/study/?acc=PRJNA1018599
2. Click "Metadata" button to download `SraRunTable.csv`
3. Place file in `tmp/SraRunTable.csv` or `tmp/{BIOPROJECT}_SraRunTable.csv`

---

## Script Specifications

### fetch-sra-metadata.js

**Purpose**: Fetch and merge run metadata with sample attributes

**Input**: BioProject ID as command-line argument

**Output**: `tmp/{BIOPROJECT}_sra_metadata.json`

**Algorithm**:
1. Query ENA Portal API for run metadata
2. Extract unique sample accessions (SAMN...)
3. Query NCBI BioSample API for custom attributes (batch by 100)
4. Merge run data with sample attributes
5. Write combined JSON to tmp/

**Output JSON structure**:
```json
{
  "bioproject": "PRJNA1018599",
  "fetchDate": "2025-11-23T...",
  "source": "ENA+BioSample",
  "runs": [
    {
      "run_accession": "SRR26104233",
      "sample_accession": "SAMN37446236",
      "sample_alias": "GSM7789499",
      "library_layout": "PAIRED",
      "library_strategy": "RNA-Seq",
      "library_selection": "cDNA",
      "instrument_model": "Illumina HiSeq 2500",
      "read_count": 11294392,
      "scientific_name": "Rhipicephalus microplus",
      "sample_attributes": {
        "infection": "Babesia infected",
        "tissue": "hemolymph",
        "cell_type": "hemocyte"
      }
    }
  ]
}
```

**Fallback behavior**:
- If ENA API fails, check for `tmp/SraRunTable.csv` or `tmp/{BIOPROJECT}_SraRunTable.csv`
- Parse CSV and output equivalent JSON structure
- Set `"source": "manual_csv"` in output

---

### fetch-miniml.js

**Purpose**: Find and download MINiML XML for GEO-linked datasets

**Input**: BioProject ID as command-line argument

**Output**: `tmp/{GSE}_family.xml` (or error message if not GEO-linked)

**Algorithm**:
1. Query NCBI GDS database for BioProject
2. Extract GEO series accession (GSE...)
3. Download MINiML archive from FTP
4. Extract XML to tmp/

**Output on success**:
```
GSE245678
```
(prints GSE accession to stdout, writes XML to tmp/)

**Output on failure**:
```
NO_GEO_LINK
```
(no GEO series found for this BioProject)

---

### generate-presenter-xml.js

**Purpose**: Generate RNA-seq datasetPresenter XML

**Input**: Command-line arguments:
```bash
node scripts/generate-presenter-xml.js <BIOPROJECT> <PROJECT_ID> <PRIMARY_CONTACT_ID> [ADDITIONAL_CONTACT_IDS...]
```

**Reads from**:
- `tmp/{BIOPROJECT}_sra_metadata.json` (required)
- `tmp/{GSE}_family.xml` (optional, for richer descriptions)

**Output**: Presenter XML to stdout

**Generated XML structure** (RNA-seq specific):
```xml
<datasetPresenter name="{organismAbbrev}_{bioproject}_rnaSeq_RSRC" projectName="{PROJECT_ID}">
  <displayName><![CDATA[RNA-Seq analysis of <i>Organism name</i>]]></displayName>
  <shortDisplayName>Short name</shortDisplayName>
  <shortAttribution>Author et al., Year</shortAttribution>
  <summary><![CDATA[Brief summary]]></summary>
  <description><![CDATA[
    <b>General Description:</b> ...
    <br><br><b>Methodology used:</b> ...
  ]]></description>
  <protocol></protocol>
  <caveat></caveat>
  <acknowledgement></acknowledgement>
  <releasePolicy></releasePolicy>
  <history buildNumber="TODO"/>
  <primaryContactId>...</primaryContactId>
  <link>
    <text>NCBI Bioproject</text>
    <url>https://www.ncbi.nlm.nih.gov/bioproject/PRJNA...</url>
  </link>
  <pubmedId>...</pubmedId>
  <templateInjector className="org.apidb.apicommon.model.datasetInjector.RNASeq">
    <prop name="switchStrandsGBrowse">false</prop>
    <prop name="switchStrandsProfiles">false</prop>
    <prop name="graphForceXLabelsHorizontal">false</prop>
    <prop name="hasFishersExactTestData">true/false</prop>
    <prop name="isEuPathDBSite">true</prop>
    <prop name="jbrowseTracksOnly">false</prop>
    <prop name="graphType">bar</prop>
    <prop name="graphColor">#336699</prop>
    <prop name="graphBottomMarginSize">50</prop>
    <prop name="graphSampleLabels"></prop>
    <prop name="showIntronJunctions">true</prop>
    <prop name="includeInUnifiedJunctions"></prop>
    <prop name="isAlignedToAnnotatedGenome">true</prop>
    <prop name="hasMultipleSamples">true/false</prop>
    <prop name="graphXAxisSamplesDescription">Description</prop>
    <prop name="graphPriorityOrderGrouping">1000</prop>
    <prop name="optionalQuestionDescription"></prop>
    <prop name="isDESeq">true/false</prop>
    <prop name="isDEGseq">false</prop>
    <prop name="includeProfileSimilarity">false</prop>
    <prop name="profileTimeShift"></prop>
  </templateInjector>
</datasetPresenter>
```

---

### generate-analysis-config.js

**Purpose**: Generate analysisConfig.xml for pipeline processing

**Input**:
```bash
node scripts/generate-analysis-config.js <BIOPROJECT> [--strand-specific]
```

**Reads from**:
- `tmp/{BIOPROJECT}_sra_metadata.json`
- Sample annotations (Claude-generated, see workflow)

**Output**: `delivery/bulk-rnaseq/{BIOPROJECT}/analysisConfig.xml`

**Generated XML structure**:
```xml
<xml>
  <step class="ApiCommonData::Load::RnaSeqAnalysisEbi">
    <property name="profileSetName" value="Short Display Name"/>
    <property name="samples">
      <value>Label 1|sampleId1</value>
      <value>Label 2|sampleId2</value>
    </property>
    <property name="isStrandSpecific" value="0"/>
  </step>
</xml>
```

---

### generate-samplesheet.js

**Purpose**: Generate samplesheet.csv for nf-core/rnaseq pipeline

**Input**:
```bash
node scripts/generate-samplesheet.js <BIOPROJECT>
```

**Reads from**:
- `tmp/{BIOPROJECT}_sra_metadata.json`
- Sample annotations (Claude-generated)

**Output**: `delivery/bulk-rnaseq/{BIOPROJECT}/samplesheet.csv`

**CSV format**:
```csv
id,fastq1,fastq2,strandedness
sampleId1,SRR26104233,,
sampleId1,SRR26104234,,
sampleId2,SRR26104235,,
```

Note: Technical replicates (same sampleId, different SRR) appear as separate rows.

---

### check-delivery-dirs.sh (NEW SHARED SCRIPT)

**Purpose**: Ensure delivery directory structure exists

**Usage**:
```bash
bash scripts/check-delivery-dirs.sh bulk-rnaseq [BIOPROJECT_ID]
```

**Behavior**:
1. Check if `delivery/` exists, create if not
2. Check if `delivery/bulk-rnaseq/` exists, create if not
3. If BIOPROJECT_ID provided, create `delivery/bulk-rnaseq/{BIOPROJECT_ID}/`
4. Return success/failure

---

## Workflow Steps

### Step 1: Fetch Metadata

1. Run `fetch-sra-metadata.js {BIOPROJECT}`
2. Run `fetch-miniml.js {BIOPROJECT}` (may return NO_GEO_LINK)
3. If fetch fails, prompt curator for manual CSV

**Outputs**:
- `tmp/{BIOPROJECT}_sra_metadata.json`
- `tmp/{GSE}_family.xml` (if GEO-linked)

### Step 2: Analyze Samples (Claude)

Claude reads the fetched metadata and:

1. **Identifies experimental factors** - which sample attributes vary between samples
2. **Generates sample annotations** - CSV with columns:
   - `sampleId` - unique biological sample identifier
   - `SRA ID(s)` - comma-separated SRR IDs (technical replicates grouped)
   - `label` - human-readable condition label for graphs
   - Additional columns for varying factors (infection, timepoint, etc.)
3. **Determines strand specificity** - from library selection/preparation info
4. **Writes commentary** - notes on processing decisions, ambiguities

**Output**: Sample annotations stored in Claude's context for use by scripts

### Step 3: Curate Contacts

Same process as genome assembly skill:

1. Identify contacts from:
   - GEO/MINiML contributor info
   - Publication authors (if PubMed linked)
   - Assembly submitter info
2. Search `allContacts.xml` for existing entries
3. Create new contacts if needed
4. Determine primary contact

**Tools**:
- Grep to search allContacts.xml
- Edit to insert new contacts
- AskUserQuestion for curator decisions

### Step 4: Generate Presenter XML

1. Run `generate-presenter-xml.js {BIOPROJECT} {PROJECT_ID} {PRIMARY_CONTACT} [ADDITIONAL_CONTACTS...]`
2. Insert generated XML into `veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/{PROJECT_ID}.xml`

**Same patterns as genome assembly**:
- Ask curator about insertion location preference
- Use offset reads for large files
- Check for existing entries before inserting

### Step 5: Generate Delivery Files

1. Run `check-delivery-dirs.sh bulk-rnaseq {BIOPROJECT}`
2. Run `generate-analysis-config.js {BIOPROJECT}`
3. Run `generate-samplesheet.js {BIOPROJECT}`
4. Write sample annotations CSV to delivery directory

**Outputs** (in `delivery/bulk-rnaseq/{BIOPROJECT}/`):
- `analysisConfig.xml`
- `samplesheet.csv`
- `sample-annotations.csv`

---

## Shared Files Configuration

Add to `package.json` `sharedFiles`:

```json
{
  "sharedFiles": {
    "scripts/check-repos.sh": [
      "curate-genome-assembly",
      "curate-bulk-rnaseq"
    ],
    "scripts/check-delivery-dirs.sh": [
      "curate-bulk-rnaseq"
    ],
    "resources/editing-large-xml.md": [
      "curate-genome-assembly",
      "curate-bulk-rnaseq"
    ],
    "resources/valid-projects.json": [
      "curate-genome-assembly",
      "curate-bulk-rnaseq"
    ]
  }
}
```

---

## Implementation Checklist

### Phase 1: Infrastructure
- [ ] Create `shared/scripts/check-delivery-dirs.sh`
- [ ] Add `delivery/` to `.gitignore`
- [ ] Update `package.json` sharedFiles
- [ ] Run `yarn sync-shared`

### Phase 2: Core Scripts
- [ ] `fetch-sra-metadata.js` - ENA + BioSample API fetching
- [ ] `fetch-miniml.js` - GEO lookup and MINiML download
- [ ] `generate-presenter-xml.js` - RNA-seq presenter template
- [ ] `generate-analysis-config.js` - Pipeline config generation
- [ ] `generate-samplesheet.js` - nf-core samplesheet format

### Phase 3: Resources
- [ ] `step-1-fetch-metadata.md`
- [ ] `step-2-analyze-samples.md`
- [ ] `step-3-curate-contacts.md`
- [ ] `step-4-generate-presenter.md`
- [ ] `step-5-generate-outputs.md`

### Phase 4: Skill Definition
- [ ] `SKILL.md` - main skill file with workflow
- [ ] `TODO.md` - future enhancements (PDF support)

### Phase 5: Testing & Finalization
- [ ] Test with PRJNA1018599 example
- [ ] Update README.md with new skill
- [ ] Delete this DEV-PLAN.md file

---

## Reference: React Component Business Logic

The original React component (`tmp/remixed-dc80420e.tsx`) contains these key processing steps that should inform our Claude prompts:

### Factor Column Analysis Prompt
```
Analyze this SRA Run Selector CSV and identify which column headings contain experimental factor values.
- DO NOT include technical columns like Run, Bytes, Platform, Instrument, etc.
- ONLY include columns that contain biological/experimental variables that vary between samples
```

### Main Processing Prompt Key Instructions
```
- FIRST STEP: Analyze sample mappings - GEO accession IDs link to MINiML descriptions
- Use structured sample data format to associate conditions with SRA IDs
- Only include annotation columns that have different values across samples
- Technical replicates are pre-grouped by sample
- Make intelligent guesses for boolean templateInjector properties
- Use species names in italics using <i> tags
- Determine strand specificity from library selection/preparation methods
- KEEP <protocol></protocol> TAGS EMPTY
```

### Sample Annotations Requirements
```
- sampleId: Unique ID (typically Sample Name or GEO accession)
- "SRA ID(s)": SRR/SRX/SRS IDs (comma-separated for technical replicates)
- label: Human-readable label for bar chart x-axis (condition combinations, NO replicate numbers)
- Additional columns for metadata that VARIES between samples
- NUMERIC COLUMNS: Put numbers in values, units in header as "columnname (unit:unitname)"
```

---

## Notes

- The React component makes direct Claude API calls; our skill uses Claude Code itself as the AI
- Prompts will be structured in the resources/ markdown files for Claude to follow
- The delivery directory approach allows outputs to be easily copied/transferred without git complexity
