# Step 3: Curate Contacts

## Overview

This step identifies and curates contact entries for the DNA-seq dataset. Contacts are stored in a shared file and referenced by ID in the presenter XML.

## Contacts File

All contacts are stored in:

```
Model/lib/xml/datasetPresenters/contacts/allContacts.xml
```

## Contact Identification Sources

1. **BioProject submitter**: the submitting organization and contact in the
   BioProject record (`https://www.ncbi.nlm.nih.gov/bioproject/<ACCESSION>`)
2. **BioSample contacts**: the submitter named on the BioSamples
3. **PubMed authors**: if a linked publication exists

### Priority
1. Principal investigator or lab head
2. Data submitter / first author
3. Senior author from associated publications

## Searching for Existing Contacts

The allContacts.xml file is large. Use grep to search for potential matches:

```bash
# Search by surname (case-insensitive)
grep -i "smith" Model/lib/xml/datasetPresenters/contacts/allContacts.xml

# Search with context to see full contact record
grep -i -A5 "smith" Model/lib/xml/datasetPresenters/contacts/allContacts.xml
```

### Diacritic-Aware Searching

For names with diacritics (é, ö, ñ, etc.), search for the base form:

```bash
# For "Müller", try:
grep -i "muller\|müller" allContacts.xml
```

## Contact XML Structure

```xml
<contact>
  <contactId>firstname.lastname</contactId>
  <name>First M. Last</name>
  <institution>University Name</institution>
  <email>email@example.com</email>
  <address></address>
  <city></city>
  <state/>
  <zip></zip>
  <country></country>
</contact>
```

### Contact ID Format

- Typically: `firstname.lastname` (lowercase, periods as separators)
- Examples: `john.smith`, `maria.garcia`, `wei.zhang`
- For common names, may include middle initial to disambiguate

## Creating New Contacts

**CRITICAL**: The allContacts.xml file is ~40,000 lines. You MUST follow this procedure:

1. **Append at the end**: insert new contacts just before `</contacts>`. Do not ask the curator.
2. **Get line count first**: `wc -l .../allContacts.xml`
3. **Use Read with offset** to read only the last ~50 lines
4. **Never read the entire file** - multiple 100-line reads wastes context

See [Editing Large XML Files](editing-large-xml.md) for detailed patterns.

### Required fields for new contacts:
   - **contactId**: Unique identifier (e.g., `firstname.lastname`, lowercase)
   - **name**: Full name as it appears in publications
   - **institution**: Current affiliation
   - **email**: Optional but helpful if available
   - Empty tags for: address, city, state, zip, country

New contacts are committed together with the proposal in the publish step and
reach `master` when the curator merges the PR. Do not commit them separately.

## Presenter XML References

The presenter XML uses two contact elements:

```xml
<primaryContactId>firstname.lastname</primaryContactId>
<contactId>another.person</contactId>  <!-- optional, for additional contacts -->
```

- **primaryContactId**: Required. The main contact for the dataset.
- **contactId**: Optional. Can have multiple for additional contributors.

## Decision Guidelines

### When to include additional contacts:
- Multiple PIs contributed to the study
- Clearly identified lab heads in submission metadata
- Paper has clear lead authors

### When to be selective:
- Large consortium papers
- Unknown relationship between authors and data generation
- Focus on corresponding author or data submitter

### Present choices to curator:
Always show the curator your findings and recommendations before finalizing contact selections.

## Next Step

Proceed to [Step 4 - Write Proposal](step-4-write-proposal.md) to write the proposal and preview it.
