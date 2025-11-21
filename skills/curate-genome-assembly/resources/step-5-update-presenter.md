# Step 5: Generate and Insert Presenter XML

## Overview

This step generates the datasetPresenter XML element and inserts it into the project's presenter file.

## Command

```bash
node scripts/generate-presenter-xml.js <GENBANK_ACCESSION> <PROJECT_ID> <PRIMARY_CONTACT_ID> [ADDITIONAL_CONTACT_IDS...]
```

## Arguments

- **genbank_accession**: GenBank assembly accession (e.g., `GCA_000988875.2`)
- **project_id**: VEuPathDB project from [valid-projects.json](valid-projects.json)
- **primary_contact_id**: Contact ID from allContacts.xml for the primary contact
- **additional_contact_ids**: (Optional) Additional contact IDs

## Example

```bash
node scripts/generate-presenter-xml.js GCA_000988875.2 FungiDB jeffrey.m.skerker
```

## What the Script Does

1. Reads all fetched metadata from `tmp/`:
   - Assembly report JSON
   - BioProject JSON (for description)
   - PubMed JSON (for publication IDs)

2. Derives fields:
   - **presenterName**: `{organismAbbrev}_primary_genome_RSRC`
   - **organismAbbrev**: First letter genus + first 3 letters species + strain

3. Generates description from:
   - BioProject description → "General Description"
   - Assembly methodology → "Methodology used"

4. Outputs complete `<datasetPresenter>` XML to stdout

## Target File

Insert the generated XML into:

```
veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/<PROJECT_ID>.xml
```

For example:
- FungiDB → `veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/FungiDB.xml`

## Finding the Insertion Point

**IMPORTANT**: The presenter file is very large (thousands of lines). Do NOT read the entire file into context.

Use grep to find the insertion point efficiently:

```bash
# Find the closing tag for insertion at end
grep -n "</datasetPresenters>" veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/FungiDB.xml

# Check if this organism already exists
grep -n "rtorNBRC0880_primary_genome_RSRC" veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/FungiDB.xml

# Find a nearby presenter to understand the structure
grep -n -A2 "<datasetPresenter name=" veupathdb-repos/ApiCommonPresenters/Model/lib/xml/datasetPresenters/FungiDB.xml | head -20
```

Read only a small section around the insertion point (e.g., 50 lines) to verify context before inserting.

## Insertion Logic

### New Entry

Insert the new `<datasetPresenter>` element:
- Before the closing `</datasetPresenters>` tag, OR
- After an existing presenter element (maintain consistent ordering if applicable)

### Updating Existing Entry

If a presenter with the same `name` attribute already exists:
- Find the start and end of that element
- Replace the entire `<datasetPresenter>...</datasetPresenter>` block
- Preserve surrounding elements

## Generated XML Structure

```xml
<datasetPresenter name="rtorNBRC0880_primary_genome_RSRC">
  <displayName><![CDATA[Genome Sequence and Annotation]]></displayName>
  <shortDisplayName></shortDisplayName>
  <shortAttribution></shortAttribution>
  <summary><![CDATA[Genome Sequence and Annotation of <i>Organism name</i> strain]]></summary>
  <description><![CDATA[
    <b>General Description:</b> ...
    <br><br><b>Methodology used:</b> ...
  ]]></description>
  <protocol></protocol>
  <caveat></caveat>
  <acknowledgement></acknowledgement>
  <releasePolicy></releasePolicy>
  <history buildNumber="TODO"
           genomeSource="INSDC" genomeVersion="GCA_..."
           annotationSource="GenBank" annotationVersion="..."/>
  <primaryContactId>...</primaryContactId>
  <link>
    <text>NCBI Bioproject</text>
    <url>https://www.ncbi.nlm.nih.gov/bioproject/...</url>
  </link>
  <link>
    <text>GenBank Assembly</text>
    <url>https://www.ncbi.nlm.nih.gov/assembly/...</url>
  </link>
  <pubmedId>...</pubmedId>
  <templateInjector projectName="..." className="org.apidb.apicommon.model.datasetInjector.AnnotatedGenome">
    <prop name="isEuPathDBSite">true</prop>
    ...
  </templateInjector>
</datasetPresenter>
```

## TODO Fields

The following fields require curator input:

- **buildNumber** in `<history>`: The VEuPathDB build number when this genome will be released
- **description**: Review and edit the auto-generated description text

## Git Operations

**Important**: The curator handles all git operations manually:
- Reviewing changes with `git diff`
- Staging files with `git add`
- Creating commits
- Pushing branches

Do not perform these operations automatically.

## Completion Checklist

After Step 5:
- [ ] Review generated XML in presenter file
- [ ] Set buildNumber in history element
- [ ] Review/edit description text
- [ ] Verify contact IDs are correct
- [ ] Check PubMed IDs are included
- [ ] Curator commits changes to branch
- [ ] Curator creates pull request
