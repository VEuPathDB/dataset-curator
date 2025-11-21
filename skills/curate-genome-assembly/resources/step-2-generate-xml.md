# Step 2: Generate Organism Dataset XML

## Overview

This step processes the NCBI metadata and generates VEuPathDB organism dataset XML configuration with auto-derived fields and NCBI data.

## Command

```bash
node scripts/generate-organism-xml.js <GENBANK_ACCESSION> <PROJECT_ID> <IS_REFERENCE_STRAIN>
```

## Arguments

- **genbank_accession**: GenBank assembly accession (e.g., `GCA_000988875.2`)
- **project_id**: VEuPathDB project from [valid-projects.json](valid-projects.json)
- **is_reference_strain**: `true` or `false`

## Example

```bash
node scripts/generate-organism-xml.js GCA_000988875.2 FungiDB true
```

## What the Script Does

### Auto-Derived Fields

The script derives several fields from organism name and strain:

1. **organismAbbrev**: First letter of genus + first 3 letters of species + strain (no special chars, max 30 chars)
   - Example: `Candida albicans SC5314` → `calbSC5314`

2. **organismNameForFiles**: PascalCase genus + species + strain (no special chars)
   - Example: `Candida albicans SC5314` → `CandidalbicansSC5314`

3. **orthomclAbbrev**: 4-letter code (first letter genus + first 3 letters species)
   - Example: `Candida albicans` → `calb`

4. **taxonFilterForNRProteinsAlignedToGenome**: Genus name
   - Example: `Candida`

### NCBI Data Extraction

The script extracts from NCBI dataset report:

- **ncbiTaxonId**: Organism taxonomic ID
- **genomeSource**: `GenBank` or `RefSeq`
- **genomeVersion**: Assembly release date
- **organismFullName**: Organism name + strain
- **strainAbbrev**: Strain with special characters removed
- **annotationIncludesTRNAs**: `true` if non-coding genes present in annotation stats

### Conditional Logic

- **isReferenceStrain**: Passed as argument
- **referenceStrainOrganismAbbrev**:
  - If reference strain → same as organismAbbrev
  - Otherwise → `TODO` (curator must look up)

### TODO Fields

These fields require curator input and are marked `TODO` in output:

- **isCore**: Is this a "core" organism for the project?
- **isNotEbiGenome**: Is genome unavailable in EBI/ENA?
- **runExportPred**: Should ExportPred be run?
- **isHugeGenome**: Is this considered a huge genome?
- **maxIntronSize**: Maximum intron size (organism-specific)
- **isFamilyRepresentative**: Is this the family representative?
- **familyRepOrganismAbbrev**: Abbreviation of family representative
- **familyNcbiTaxonIds**: Taxon IDs for the family
- **familyNameForFiles**: Family name for file naming

## Output

The script outputs two dataset elements to stdout:

1. **organism dataset** (always)
2. **referenceStrain dataset** (only if `is_reference_strain` is `true`)

## Validation

The script validates:
- Project ID against valid-projects.json
- is_reference_strain is exactly `true` or `false`
- NCBI JSON file exists and is readable
- Case-sensitive project ID matching with helpful error messages

## Next Step

The generated XML needs to be inserted into the project's dataset file (see [Step 3](step-3-update-files.md)).
