# Organism Abbreviation System

This document describes the centralized organism abbreviation system used across VEuPathDB curation tools.

## Overview

The organism abbreviation system provides consistent, standardized abbreviations for organism names used in datasetPresenter naming conventions.

## Reference Data

**File:** `shared/resources/organism-abbreviations.csv`

**Structure:**
- `project` - VEuPathDB project (FungiDB, VectorBase, etc.)
- `organism_full_name` - Complete organism name including strain
- `organism_abbreviation` - Standardized abbreviation
- `is_annotated_genome` - 1 if genome is annotated, 0 otherwise
- `is_reference_strain` - 1 if reference strain, 0 otherwise
- `orthoMCL_abbrev` - OrthoMCL abbreviation

## Abbreviation Logic

**Format:** `${genus[0].toLowerCase()}${species.substring(0,3)}${cleanedStrain}`

**Strain Cleaning Rules:**
- Remove: "isolate", "strain", "breed", "str." (case insensitive)
- Remove: `/`, `,`, `:`
- Replace: `#` → `-`, `.` → `-`

## Usage in Curation Tools

### RNA-seq Datasets
- Enhanced presenter naming: `orgAbbrev_Author_Year_rnaSeq_RSRC`
- Interactive organism input with lookup/generation
- Fallback to submitter attribution when no publications found

### Adding New Organisms

When a new organism is not found in the reference data:
1. Tool generates abbreviation using standardized logic
2. Curator can confirm or override generated abbreviation
3. Tool outputs suggested CSV line for manual addition
4. Curator adds line to `shared/resources/organism-abbreviations.csv`
5. Changes get distributed via git and sync mechanisms

## Maintenance

- **Source of truth:** `shared/resources/organism-abbreviations.csv` in dataset-curator repository
- **Distribution:** Synced to all skills via `yarn sync-shared`
- **Updates:** Manual curation via git workflow (feature branches, PRs)
- **External sync:** Periodic sync with Google Sheets reference (manual process)