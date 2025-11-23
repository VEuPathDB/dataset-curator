# TODO: curate-bulk-rnaseq

## Initial Implementation

Things to tweak before first release.

### Description and methodology generation

This needs to be done more by Claude and less by scripting. Currently
@scripts/generate-presenter-xml.js injects the description it finds in
the MINiMl XML or SRA metadata. It would be better if this were more
AI-generated, but perhaps this should coincide with the PDF support
feature outlined below?

### Strandedness detection

Currently `generate-samplesheet.js` defaults to `auto` strandedness. The original Artifact used Claude AI (often with the publication PDF) to determine strandedness from sequencing technology details that aren't always in the SRA/ENA/GEO metadata.

This should probably be addressed alongside PDF support - Claude can analyze the methods section to determine library prep protocol and infer strandedness.

For now, curators should verify and manually edit the samplesheet if needed.

## Planned Features

Future enhancements for this skill.

### PDF Support for Journal Articles

**Priority**: Medium
**Complexity**: Medium

Add support for curators to provide a journal article PDF for additional experimental context.

**Implementation notes**:
- Accept PDF path as optional input
- Use Claude's document understanding to extract:
  - Experimental design details
  - Sample groupings and conditions
  - Author/contact information
  - Publication metadata (for PubMed lookup)
- Integrate extracted info into sample annotation generation

**Considerations**:
- PDF processing uses more tokens
- Not all datasets have associated publications
- Some publications may not be open access

---

## Ideas for Future Consideration

### Automatic PubMed Linking
- Search PubMed for papers citing the BioProject
- Extract publication metadata automatically

### Sample Annotation Templates
- Pre-defined templates for common experimental designs
- Time-course, treatment vs control, tissue comparison, etc.

### Validation Scripts
- Validate generated XML against schema
- Check sample IDs match between files
- Verify contact IDs exist in allContacts.xml

### Integration with Pipeline
- Direct submission to processing queue
- Status tracking for submitted datasets
