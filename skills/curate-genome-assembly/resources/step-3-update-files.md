# Step 3: Insert XML into Project Dataset File

## Overview

This step inserts the generated organism dataset XML into the project's main dataset configuration file.

## Target File

The XML should be inserted into:

```
veupathdb-repos/ApiCommonDatasets/Datasets/lib/xml/datasets/<PROJECT_ID>.xml
```

For example:
- FungiDB → `veupathdb-repos/ApiCommonDatasets/Datasets/lib/xml/datasets/FungiDB.xml`
- PlasmoDB → `veupathdb-repos/ApiCommonDatasets/Datasets/lib/xml/datasets/PlasmoDB.xml`

## Insertion Logic

### Case 1: New Organism

If an organism with this `organismAbbrev` doesn't exist in the file:
- **Append** the new `<dataset class="organism">` element(s) inside the `<datasets>` root element
- Place before the closing `</datasets>` tag

### Case 2: Updating Existing Organism

If an organism with this `organismAbbrev` already exists:
- **Replace** the existing `<dataset class="organism">` element with the new one
- Also replace the `<dataset class="referenceStrain">` element if present
- Preserve other organisms in the file

## File Structure

The target XML file has this structure:

```xml
<datasets>
  <constant name="projectName">ProjectName</constant>

  <!-- Multiple organism datasets -->
  <dataset class="organism">
    <prop name="organismAbbrev">organism1</prop>
    <!-- ... other properties ... -->
  </dataset>

  <dataset class="referenceStrain">
    <prop name="organismAbbrev">organism1</prop>
    <!-- ... properties ... -->
  </dataset>

  <dataset class="organism">
    <prop name="organismAbbrev">organism2</prop>
    <!-- ... other properties ... -->
  </dataset>

  <!-- More organisms... -->
</datasets>
```

## Curator Review Required

After inserting the XML, **warn the curator** about TODO fields that need manual input:

- `isCore`
- `isNotEbiGenome`
- `runExportPred`
- `isHugeGenome`
- `maxIntronSize`
- `isFamilyRepresentative`
- `familyRepOrganismAbbrev`
- `familyNcbiTaxonIds`
- `familyNameForFiles`

If `isReferenceStrain` is `false`, also highlight:
- `referenceStrainOrganismAbbrev` (must look up the reference strain)

## Git Operations

**Important**: The curator handles all git operations manually:
- Reviewing changes with `git diff`
- Staging files with `git add`
- Creating commits
- Pushing branches

Do not perform these operations automatically.

## Next Steps

After completing Step 3:
1. Review the generated XML and TODO fields
2. Curator manually fills in TODO fields
3. Curator commits changes to their dataset branch
4. Curator creates pull request for review

## Further Steps (TBC)

Additional steps for genome assembly curation will be documented as the workflow is refined:
- Updating presenter configurations
- Adding model definitions
- Setting up dataset loaders
- Configuring build properties
