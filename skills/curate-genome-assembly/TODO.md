# TODO: Unresolved Issues

## NCBI Publications Discovery

**Status:** Unresolved
**Date:** 2024-11-22

### Problem

NCBI Datasets displays a "Publications" section on genome assembly pages (e.g., https://www.ncbi.nlm.nih.gov/datasets/genome/GCA_045838185.1/) that shows linked publications. However, we have not found a way to query this data via NCBI web services.

### What We Tried

The following E-utilities elink queries all returned no linked publications for GCA_045838185.1 / PRJNA1181959, despite the web page showing PMID 39895666:

- `elink dbfrom=bioproject db=pubmed` - No results
- `elink dbfrom=assembly db=pubmed` - No results
- `elink dbfrom=nuccore db=pubmed` - No results
- `elink dbfrom=biosample db=pubmed` - No results
- `elink dbfrom=pubmed db=bioproject` (reverse) - No results
- NCBI Datasets API `/links` endpoint - No publication links

### Hypothesis

NCBI Datasets appears to use text mining or an internal system (not exposed via E-utilities) to match publications to assemblies. This may involve:
- Searching publication full text for accession numbers
- Matching organism name + strain combinations
- A newer internal linking database

### Current Workaround

Curators are asked to manually check the NCBI genome assembly page and provide any PubMed IDs found there. See Step 3 documentation for instructions.

### Potential Future Solutions

1. **Text-based PubMed search fallback** - Search PubMed for organism name + strain + "genome" when elink returns nothing
2. **Accession search** - Search PubMed for assembly accession or BioProject accession in article text
3. **NCBI Datasets API update** - Monitor for new API endpoints that expose the Publications data shown on the web interface
4. **Contact NCBI** - Ask NCBI helpdesk how to programmatically access the Publications section data
