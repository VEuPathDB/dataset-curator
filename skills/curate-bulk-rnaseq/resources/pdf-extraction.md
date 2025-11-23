# PDF Extraction

This resource describes how to extract structured data from a journal article PDF for use in later workflow steps.

## IMPORTANT: Use a Task Subagent

**To preserve context in the main conversation, PDF extraction MUST be performed using a Task subagent.**

The PDF content is large and would consume most of the conversation context. By using a subagent:
- The full PDF stays in the subagent's isolated context
- Only the extracted JSON and a brief summary return to the main conversation
- The main conversation retains capacity for the remaining workflow steps

### Task Subagent Prompt

Use the Task tool with a prompt like:

```
Read the PDF at tmp/<BIOPROJECT>_article.pdf and extract structured data following the schema in resources/pdf-extraction.md.

Save the extracted data to tmp/<BIOPROJECT>_pdf_extracted.json

Return a brief summary: strandedness found, number of authors extracted, whether Author Contributions section was present.
```

---

## Check for PDF

Ask the curator if they have a PDF available. If yes, confirm the file exists at `tmp/<BIOPROJECT>_article.pdf`.

## Output Schema

The JSON output **must include** the required fields below at these exact paths. Downstream scripts depend on this structure. You may add additional fields as useful, but the required fields must be present.

**Required fields** (scripts depend on these paths):
- `extracted.strandedness` - Used by `generate-samplesheet.js`
- `extracted.authors[]` - Used by Step 3 contact curation
- `textChunks.abstract` - Used by Step 4 description generation
- `textChunks.methods` - Used by Step 4 methodology generation

```json
{
  "bioproject": "PRJNA1018599",
  "pdfSource": "tmp/PRJNA1018599_article.pdf",
  "extracted": {
    "strandedness": "stranded|unstranded|unknown",
    "libraryPrepProtocol": "TruSeq Stranded mRNA",
    "authors": [
      {
        "name": "Full Name",
        "affiliation": "University/Institute",
        "roles": ["corresponding author", "conceived project", "performed experiments"],
        "isLikelyDataSubmitter": true
      }
    ]
  },
  "textChunks": {
    "abstract": "Full abstract text...",
    "methods": "Relevant methods section text (RNA extraction, library prep, sequencing)...",
    "introConclusion": "Final paragraph of introduction summarizing the study goals...",
    "authorAffiliations": "Full author list with affiliations as printed..."
  }
}
```

**Optional additional fields**: Feel free to add other useful extracted data (article metadata, conditions, organism info, etc.) as top-level or nested fields.

## Extracting Strandedness

Look in the Methods section for library preparation details:

| Protocol/Kit | Strandedness |
|--------------|--------------|
| TruSeq Stranded | `stranded` |
| NEBNext Ultra II Directional | `stranded` |
| dUTP method | `stranded` |
| SMARTer Stranded | `stranded` |
| TruSeq (non-stranded) | `unstranded` |
| Unclear/not mentioned | `unknown` |

**Note**: Most RNA-seq from 2016+ is stranded. If the paper mentions "strand-specific" or uses a directional protocol, use `stranded`.

## Identifying Author Roles

The `roles` field is an array of strings. Always include positional roles (sufficient to identify primaryContactId), and add detailed contributions if available.

**Always include positional roles:**
- `"corresponding author"` - marked with `*` or email in author list
- `"first author"` - first in author list
- `"last author"` - last/senior author (often PI)

**If an Author Contributions section exists**, decode it and add contribution details:
- Match abbreviations to full names (e.g., "M.U." → "Massaro Ueti")
- Add contribution phrases: `"conceived project"`, `"supervised"`, `"performed experiments"`, `"analyzed data"`, `"drafted manuscript"`, etc.
- These details help identify secondary contacts specifically involved in transcriptomics

**If no Author Contributions section**, the positional roles alone are sufficient for contact curation.

**Data submitter**: May be mentioned in acknowledgments or data availability section. Cross-reference authors with GEO contributors or BioProject submitters.

## Example Extraction

For a paper titled "Transcriptome analysis of tick hemocytes during Babesia infection":

```json
{
  "bioproject": "PRJNA1018599",
  "pdfSource": "tmp/PRJNA1018599_article.pdf",

  "extracted": {
    "strandedness": "stranded",
    "libraryPrepProtocol": "TruSeq Stranded mRNA Library Prep Kit",
    "authors": [
      {
        "name": "Jane Smith",
        "affiliation": "Department of Entomology, State University",
        "roles": ["first author", "corresponding author", "performed experiments", "analyzed data"],
        "isLikelyDataSubmitter": true
      },
      {
        "name": "John Doe",
        "affiliation": "Department of Entomology, State University",
        "roles": ["last author", "conceived project", "supervised"],
        "isLikelyDataSubmitter": false
      }
    ]
  },

  "textChunks": {
    "abstract": "Tick-borne diseases pose significant threats... This study examines transcriptional changes in R. microplus hemocytes during B. bigemina infection...",
    "methods": "Total RNA was extracted using TRIzol reagent. Libraries were prepared using TruSeq Stranded mRNA Library Prep Kit (Illumina) and sequenced on HiSeq 2500...",
    "introConclusion": "To better understand tick immune responses to Babesia infection, we performed RNA-seq analysis of hemocytes from infected and uninfected R. microplus ticks at multiple timepoints.",
    "authorAffiliations": "Jane Smith1*, John Doe1. 1Department of Entomology, State University, City, Country. *Corresponding author: jdoe@university.edu"
  },

  "article": {
    "title": "Transcriptome analysis of tick hemocytes during Babesia infection",
    "journal": "Parasites & Vectors",
    "year": 2025,
    "doi": "10.1186/s13071-025-06662-w"
  },
  "organism": "Rhipicephalus microplus",
  "conditions": ["B. bovis-infected", "B. bigemina-infected", "Uninfected control"]
}
```

Note: The `extracted` and `textChunks` sections contain the **required** fields. The `article`, `organism`, and `conditions` fields are examples of **optional additions** that provide useful context.
