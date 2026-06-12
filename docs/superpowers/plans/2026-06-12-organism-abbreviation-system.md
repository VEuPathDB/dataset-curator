# Organism Abbreviation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement centralized organism abbreviation system with enhanced datasetPresenter naming convention for RNA-seq datasets

**Architecture:** CSV-based organism reference system with interactive curator input, JavaScript port of existing Perl abbreviation logic, and enhanced naming using publication/submitter attribution

**Tech Stack:** Node.js (ES modules), CSV parsing, NCBI E-utilities, interactive prompts

---

### Task 1: Create Feature Branch and Bootstrap Organism CSV

**Files:**
- Create: `shared/resources/organism-abbreviations.csv`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feature/organism-abbreviation-system
```

- [ ] **Step 2: Fetch Google Sheets data as CSV**

Access: https://docs.google.com/spreadsheets/d/1wzcwku6eB9jKCOiyKxKAa7G0S0DyCNMmC6zL9l_Ulxk/edit?gid=936297455#gid=936297455
Go to File → Download → Comma-separated values (.csv)
Save as `organism-data.csv` temporarily

- [ ] **Step 3: Create shared organism reference file**

```csv
project,organism_full_name,organism_abbreviation,is_annotated_genome,is_reference_strain,orthoMCL_abbrev
FungiDB,Zymoseptoria tritici IPO323,ztriIPO323,1,1,ztri
VectorBase,Anopheles gambiae PEST,agamPEST,1,1,agam
```

Copy relevant rows from downloaded CSV to `shared/resources/organism-abbreviations.csv`

- [ ] **Step 4: Verify CSV format and content**

```bash
head -5 shared/resources/organism-abbreviations.csv
wc -l shared/resources/organism-abbreviations.csv
```

Expected: Header row + data rows, proper CSV formatting

- [ ] **Step 5: Commit organism reference data**

```bash
git add shared/resources/organism-abbreviations.csv
git commit -m "feat: add central organism abbreviation reference

- Bootstrap from existing Google Sheets data
- Includes project, organism name, abbreviation mappings
- Supports filtering by annotated genome and reference strain status

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 2: Port BioProject Fetching to RNA-seq Skill

**Files:**
- Create: `skills/curate-bulk-rnaseq/scripts/fetch-bioproject.js`

- [ ] **Step 1: Copy BioProject script from genome skill**

```bash
cp skills/curate-genome-assembly/scripts/fetch-bioproject.js skills/curate-bulk-rnaseq/scripts/
```

- [ ] **Step 2: Test BioProject fetching works**

```bash
cd skills/curate-bulk-rnaseq
node scripts/fetch-bioproject.js PRJNA223552
```

Expected: Creates `tmp/PRJNA223552_bioproject.json` with submitter organization and registration date

- [ ] **Step 3: Verify output structure**

```bash
cat tmp/PRJNA223552_bioproject.json | head -10
```

Expected: JSON with `submitterOrganization` and `registrationDate` fields

- [ ] **Step 4: Commit BioProject integration**

```bash
git add skills/curate-bulk-rnaseq/scripts/fetch-bioproject.js
git commit -m "feat: add BioProject metadata fetching to RNA-seq skill

- Port fetch-bioproject.js from genome assembly skill
- Enables access to submitter organization and registration date
- Supports fallback attribution for presenter naming

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 3: Implement Organism Abbreviation Utilities

**Files:**
- Create: `skills/curate-bulk-rnaseq/scripts/organism-utils.js`

- [ ] **Step 1: Write organism abbreviation generation function**

```javascript
#!/usr/bin/env node
/**
 * organism-utils.js - Organism abbreviation generation utilities
 * 
 * JavaScript port of Perl logic for generating organism abbreviations
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Generate organism abbreviation using standardized logic
 * Port of Perl script logic: genus[0] + species[0:3] + cleaned_strain
 */
export function generateOrganismAbbrev(organismFullName) {
    if (!organismFullName || typeof organismFullName !== 'string') {
        throw new Error('Organism name must be a non-empty string');
    }

    const items = organismFullName.trim().split(/\s+/);
    
    // Extract genus (remove brackets if present)
    let genus = items.shift() || '';
    genus = genus.replace(/^\[/, '').replace(/\]$/, '');
    
    // Extract species
    const species = items.shift() || '';
    
    // Process strain abbreviation from remaining parts
    let strainAbbrev = items.join('');
    strainAbbrev = strainAbbrev.replace(/isolate/gi, '');
    strainAbbrev = strainAbbrev.replace(/strain/gi, '');
    strainAbbrev = strainAbbrev.replace(/breed/gi, '');
    strainAbbrev = strainAbbrev.replace(/str\./gi, '');
    strainAbbrev = strainAbbrev.replace(/\//g, '');
    strainAbbrev = strainAbbrev.replace(/,/g, '');
    strainAbbrev = strainAbbrev.replace(/:/g, '');
    strainAbbrev = strainAbbrev.replace(/#/g, '-');
    strainAbbrev = strainAbbrev.replace(/\./g, '-');
    
    // Generate final abbreviation
    const organismAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3) + strainAbbrev;
    const orthomclAbbrev = genus.charAt(0).toLowerCase() + species.substring(0, 3);
    
    return { 
        organismAbbrev, 
        orthomclAbbrev, 
        genus, 
        species, 
        strainAbbrev 
    };
}

/**
 * Look up organism in CSV reference file
 */
export function lookupOrganism(csvPath, organismName) {
    try {
        const csvData = readFileSync(csvPath, 'utf-8');
        const lines = csvData.trim().split('\n');
        
        if (lines.length < 2) {
            console.warn('CSV file is empty or has no data rows');
            return null;
        }
        
        // Skip header row, parse data rows
        const rows = lines.slice(1).map(line => {
            const columns = line.split(',');
            if (columns.length < 6) {
                return null; // Skip malformed rows
            }
            
            return {
                project: columns[0]?.trim(),
                fullName: columns[1]?.trim(),
                abbrev: columns[2]?.trim(),
                annotated: columns[3]?.trim(),
                reference: columns[4]?.trim(),
                orthomcl: columns[5]?.trim()
            };
        }).filter(row => row !== null);
        
        // Filter for annotated genome = 1 AND reference strain = 1
        const validOrganisms = rows.filter(org => 
            org.annotated === '1' && org.reference === '1'
        );
        
        // Exact match on organism full name (case insensitive)
        return validOrganisms.find(org => 
            org.fullName.toLowerCase() === organismName.trim().toLowerCase()
        ) || null;
        
    } catch (error) {
        console.warn(`CSV lookup failed: ${error.message}`);
        return null;
    }
}

/**
 * Interactive prompt for organism name
 */
export async function promptOrganismName() {
    return new Promise((resolve) => {
        process.stdout.write('Enter organism name: ');
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}

/**
 * Interactive confirmation prompt
 */
export async function promptConfirm(message) {
    return new Promise((resolve) => {
        process.stdout.write(`${message} [Y/n]: `);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            const response = data.toString().trim().toLowerCase();
            resolve(response === '' || response === 'y' || response === 'yes');
        });
    });
}

/**
 * Interactive prompt for custom abbreviation
 */
export async function promptCustomAbbrev() {
    return new Promise((resolve) => {
        process.stdout.write('Enter custom organism abbreviation: ');
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        process.stdin.once('data', (data) => {
            process.stdin.pause();
            resolve(data.toString().trim());
        });
    });
}
```

- [ ] **Step 2: Test organism abbreviation generation**

```bash
cd skills/curate-bulk-rnaseq
node -e "
import { generateOrganismAbbrev } from './scripts/organism-utils.js';
console.log(generateOrganismAbbrev('Zymoseptoria tritici IPO323'));
console.log(generateOrganismAbbrev('Fusarium graminearum PH-1'));
"
```

Expected: `{ organismAbbrev: 'ztriIPO323', orthomclAbbrev: 'ztri', ... }` and `{ organismAbbrev: 'fgraPH-1', orthomclAbbrev: 'fgra', ... }`

- [ ] **Step 3: Test CSV lookup with existing data**

```bash
node -e "
import { lookupOrganism } from './scripts/organism-utils.js';
const result = lookupOrganism('../../shared/resources/organism-abbreviations.csv', 'Zymoseptoria tritici IPO323');
console.log(result);
"
```

Expected: Returns organism object if found, null if not found

- [ ] **Step 4: Commit organism utilities**

```bash
git add skills/curate-bulk-rnaseq/scripts/organism-utils.js
git commit -m "feat: add organism abbreviation generation utilities

- JavaScript port of existing Perl abbreviation logic
- CSV lookup for existing organism abbreviations
- Interactive prompts for curator input and confirmation
- Support for filtering by annotated genome and reference strain

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 4: Enhance Presenter XML Generation with Organism Input

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js:20-50`
- Modify: `skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js:290-310`

- [ ] **Step 1: Add organism utilities import**

Add at top of `generate-presenter-xml.js` after existing imports:

```javascript
import { 
  generateOrganismAbbrev, 
  lookupOrganism, 
  promptOrganismName, 
  promptConfirm, 
  promptCustomAbbrev 
} from './organism-utils.js';
```

- [ ] **Step 2: Add BioProject data reading function**

Add after the `readPublicationData` function:

```javascript
/**
 * Read BioProject metadata for submitter fallback information
 */
function readBioprojectData(bioproject) {
    const bioprojectPath = resolve(`tmp/${bioproject}_bioproject.json`);
    
    if (!existsSync(bioprojectPath)) {
        console.warn(`  BioProject metadata not found: ${bioprojectPath}`);
        return { submitterOrganization: 'Unknown', registrationDate: new Date().getFullYear().toString() };
    }
    
    try {
        const data = readFileSync(bioprojectPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.warn(`  Failed to read BioProject data: ${error.message}`);
        return { submitterOrganization: 'Unknown', registrationDate: new Date().getFullYear().toString() };
    }
}
```

- [ ] **Step 3: Add interactive organism input function**

Add after `readBioprojectData` function:

```javascript
/**
 * Interactive organism abbreviation lookup/generation
 */
async function getOrganismAbbreviation() {
    const csvPath = resolve('../../shared/resources/organism-abbreviations.csv');
    
    // Get organism name from curator
    const organismName = await promptOrganismName();
    console.error(`  Looking up: ${organismName}`);
    
    // Try CSV lookup first
    const found = lookupOrganism(csvPath, organismName);
    
    if (found) {
        console.error(`  Found in database: ${found.abbrev}`);
        const useExisting = await promptConfirm(`Use '${found.abbrev}' as organism abbreviation?`);
        
        if (useExisting) {
            console.error(`  Using: ${found.abbrev}`);
            return found.abbrev;
        } else {
            const custom = await promptCustomAbbrev();
            console.error(`  Using custom: ${custom}`);
            return custom;
        }
    } else {
        // Generate new abbreviation
        console.error(`  Not found in database`);
        const generated = generateOrganismAbbrev(organismName);
        console.error(`  Generated: ${generated.organismAbbrev} (${generated.genus.charAt(0).toLowerCase()} + ${generated.species.substring(0,3)} + ${generated.strainAbbrev})`);
        
        const useGenerated = await promptConfirm(`Use '${generated.organismAbbrev}' as organism abbreviation?`);
        
        let finalAbbrev;
        if (useGenerated) {
            finalAbbrev = generated.organismAbbrev;
        } else {
            finalAbbrev = await promptCustomAbbrev();
        }
        
        console.error(`  Using: ${finalAbbrev}`);
        console.error('');
        console.error('ADD TO shared/resources/organism-abbreviations.csv:');
        console.error(`FungiDB,${organismName},${finalAbbrev},1,1,${generated.orthomclAbbrev}`);
        console.error('');
        
        return finalAbbrev;
    }
}
```

- [ ] **Step 4: Test organism input functionality**

```bash
cd skills/curate-bulk-rnaseq
node -e "
import { resolve } from 'path';
import { 
  generateOrganismAbbrev, 
  lookupOrganism
} from './scripts/organism-utils.js';

// Test generation
const result = generateOrganismAbbrev('Fusarium graminearum PH-1');
console.log('Generated:', result);

// Test lookup  
const csvPath = resolve('../../shared/resources/organism-abbreviations.csv');
const found = lookupOrganism(csvPath, 'Zymoseptoria tritici IPO323');
console.log('Found:', found);
"
```

Expected: Generation and lookup working correctly

- [ ] **Step 5: Commit organism input functionality**

```bash
git add skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js
git commit -m "feat: add interactive organism input to presenter XML generation

- Import organism abbreviation utilities
- Add BioProject metadata reading for fallback data
- Implement interactive organism lookup and generation workflow
- Support curator override of generated abbreviations

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 5: Implement Enhanced Presenter Naming Convention

**Files:**
- Modify: `skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js:290-320`

- [ ] **Step 1: Add author name extraction utilities**

Add after `getOrganismAbbreviation` function:

```javascript
/**
 * Extract last name from author name
 */
function extractLastName(authorName) {
    if (!authorName || typeof authorName !== 'string') {
        return 'Unknown';
    }
    
    // Handle formats like "Smith J", "John Smith", "Smith, John", etc.
    const name = authorName.trim();
    
    // Split by comma first (for "Last, First" format)
    if (name.includes(',')) {
        return name.split(',')[0].trim();
    }
    
    // Split by space and take last word
    const parts = name.split(/\s+/);
    return parts[parts.length - 1];
}

/**
 * Extract year from date string
 */
function extractYear(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return new Date().getFullYear().toString();
    }
    
    // Try to extract 4-digit year
    const yearMatch = dateStr.match(/(\d{4})/);
    return yearMatch ? yearMatch[1] : new Date().getFullYear().toString();
}

/**
 * Clean submitter organization name for use in presenter name
 */
function cleanSubmitterName(submitterOrg) {
    if (!submitterOrg || typeof submitterOrg !== 'string') {
        return 'Unknown';
    }
    
    // Remove common organizational terms and clean for use in identifier
    let cleaned = submitterOrg
        .replace(/university/gi, 'U')
        .replace(/college/gi, 'C')
        .replace(/institute/gi, 'I')
        .replace(/laboratory/gi, 'Lab')
        .replace(/department/gi, 'Dept')
        .replace(/of /gi, '')
        .replace(/the /gi, '')
        .replace(/[^a-zA-Z0-9]/g, ''); // Remove special characters
    
    // Take first 10 characters to keep names reasonable
    return cleaned.substring(0, 10) || 'Unknown';
}
```

- [ ] **Step 2: Replace presenter name generation logic**

Find the line `const presenterName = \`${organismAbbrev}_${bioproject}_rnaSeq_RSRC\`;` (around line 296) and replace with:

```javascript
  // Get organism abbreviation interactively
  const orgAbbrev = await getOrganismAbbreviation();

  // Read publication data (already implemented)
  const publicationData = readPublicationData(bioproject);
  
  // Read BioProject data for fallback
  const bioprojectData = readBioprojectData(bioproject);
  
  // Determine author/submitter and year
  let authorOrSubmitter, year;
  
  if (publicationData.pmidCount > 0) {
    // Use first author's last name and publication year
    const firstAuthor = publicationData.publications[0].authors[0];
    authorOrSubmitter = extractLastName(firstAuthor.name);
    year = extractYear(publicationData.publications[0].pubdate);
    console.error(`  Using publication: ${authorOrSubmitter} (${year})`);
  } else {
    // Fallback to submitter organization and registration year
    authorOrSubmitter = cleanSubmitterName(bioprojectData.submitterOrganization);
    year = extractYear(bioprojectData.registrationDate);
    console.error(`  Using submitter: ${authorOrSubmitter} (${year})`);
  }
  
  // Generate enhanced presenter name
  const presenterName = `${orgAbbrev}_${authorOrSubmitter}_${year}_rnaSeq_RSRC`;
```

- [ ] **Step 3: Update main function to be async**

Change the main function signature from `async function main() {` to handle the async organism input. Find the line around line 270 and update:

```javascript
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: node generate-presenter-xml.js <bioproject> <project_id> <primary_contact_id> [additional_contact_ids...]');
    // ... rest of usage text stays the same
    process.exit(1);
  }
```

- [ ] **Step 4: Test enhanced naming with test data**

Create test data and run:

```bash
echo '{"runs":[{"accession":"SRR123","biosample":"SAMN123"}],"bioproject":"TEST_BIOPROJECT","title":"Test Dataset"}' > tmp/TEST_BIOPROJECT_sra_metadata.json

echo '{"publications":[{"pmid":"12345","title":"Test Publication","authors":[{"name":"Smith JD","authtype":"Author"}],"journal":"Test Journal","pubdate":"2023-01-01"}],"searchMethod":"bioproject","pmidCount":1}' > tmp/TEST_BIOPROJECT_publications.json

echo '{"accession":"TEST_BIOPROJECT","submitterOrganization":"University of Example","registrationDate":"2023-01-01"}' > tmp/TEST_BIOPROJECT_bioproject.json
```

- [ ] **Step 5: Commit enhanced naming convention**

```bash
git add skills/curate-bulk-rnaseq/scripts/generate-presenter-xml.js
git commit -m "feat: implement enhanced presenter naming convention

- Use orgAbbrev_Author_Year_rnaSeq_RSRC format
- Extract author last name from publication data
- Fallback to submitter organization and registration year
- Clean and format names for identifier use
- Interactive organism abbreviation input

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 6: Add BioProject Fetching Step to Workflow

**Files:**
- Modify: `skills/curate-bulk-rnaseq/SKILL.md:25-35`
- Create: `skills/curate-bulk-rnaseq/resources/step-2b-fetch-bioproject.md`

- [ ] **Step 1: Create BioProject fetching documentation**

```markdown
# Step 2b: Fetch BioProject Metadata

This step fetches BioProject metadata to get submitter organization and registration date for fallback attribution.

## Overview

When publications are not available, the enhanced presenter naming uses submitter information from the BioProject as fallback attribution.

## Command

```bash
node scripts/fetch-bioproject.js <BIOPROJECT>
```

Replace `<BIOPROJECT>` with the accession (e.g., `PRJNA1018599`).

## Example

```bash
node scripts/fetch-bioproject.js PRJNA1018599
```

## What This Fetches

- **BioProject title and description**
- **Submitter organization** - Used for fallback attribution
- **Registration date** - Used for fallback year
- **Organism information** - Additional metadata

## Expected Output

The JSON file is saved to `tmp/<BIOPROJECT>_bioproject.json`:

```json
{
  "accession": "PRJNA1018599",
  "id": "1018599",
  "title": "RNA-seq of Rhipicephalus microplus...",
  "description": "Comparative transcriptome...",
  "organism": "Rhipicephalus microplus",
  "submitterOrganization": "University of São Paulo",
  "registrationDate": "2023-01-15"
}
```

## Integration

This data is automatically used by the presenter XML generation step when:
- No publications are found for the dataset
- Fallback attribution is needed for presenter naming

---

**Next Step:** [Step 3: Curate Contacts](step-3-curate-contacts.md)
```

- [ ] **Step 2: Update main skill workflow**

In `skills/curate-bulk-rnaseq/SKILL.md`, find the workflow section (around line 25) and update:

```markdown
## RNA-seq Curation Workflow

1. [Fetch SRA Metadata](resources/step-1-fetch-metadata.md)
2. [Analyze Samples](resources/step-2-analyze-samples.md)  
2a. [Fetch Publications](resources/step-2a-fetch-publications.md)  
2b. [Fetch BioProject Metadata](resources/step-2b-fetch-bioproject.md)  
3. [Curate Contacts](resources/step-3-curate-contacts.md)
4. [Generate Presenter XML](resources/step-4-generate-presenter.md)
5. [Generate Delivery Outputs](resources/step-5-generate-outputs.md)
```

- [ ] **Step 3: Update presenter generation documentation**

In `skills/curate-bulk-rnaseq/resources/step-4-generate-presenter.md`, find the command section and update to mention organism input:

Find the line with the generate command and update the description above it:

```markdown
This step generates VEuPathDB datasetPresenter XML configuration with enhanced naming convention using organism abbreviations and publication/submitter attribution.

**Interactive Input Required:** You will be prompted to enter the organism name for abbreviation lookup/generation.
```

- [ ] **Step 4: Test workflow documentation**

```bash
cd skills/curate-bulk-rnaseq
head -30 SKILL.md | grep -E "Step|Fetch"
head -10 resources/step-2b-fetch-bioproject.md
```

Expected: Shows updated workflow with Step 2b, BioProject documentation exists

- [ ] **Step 5: Commit workflow documentation updates**

```bash
git add skills/curate-bulk-rnaseq/SKILL.md skills/curate-bulk-rnaseq/resources/step-2b-fetch-bioproject.md skills/curate-bulk-rnaseq/resources/step-4-generate-presenter.md
git commit -m "docs: update workflow for organism abbreviation and BioProject fetching

- Add Step 2b for BioProject metadata fetching
- Update main workflow to include organism input step
- Document interactive organism name prompts
- Explain fallback attribution mechanism

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 7: Test Complete Workflow End-to-End

**Files:**
- Test: Integration test with real data

- [ ] **Step 1: Clean test environment**

```bash
cd skills/curate-bulk-rnaseq
rm -f tmp/PRJNA223552_*
```

- [ ] **Step 2: Run complete workflow test**

```bash
# Step 1: Fetch SRA metadata
node scripts/fetch-sra-metadata.js PRJNA223552

# Step 2a: Fetch publications  
node scripts/fetch-pubmed.js --bioproject PRJNA223552

# Step 2b: Fetch BioProject metadata
node scripts/fetch-bioproject.js PRJNA223552

# Verify all data files exist
ls -la tmp/PRJNA223552_*
```

Expected: Three JSON files created (sra_metadata, publications, bioproject)

- [ ] **Step 3: Test interactive presenter generation**

Create a test script to simulate interactive input:

```bash
cat > test-interactive.js << 'EOF'
import { spawn } from 'child_process';

const child = spawn('node', ['scripts/generate-presenter-xml.js', 'PRJNA223552', 'VectorBase', 'test.contact'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', (data) => {
  output += data.toString();
});

child.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString());
});

// Simulate organism input
child.stdin.write('Rhipicephalus microplus\n');

// Wait for organism abbreviation prompt and confirm
setTimeout(() => {
  child.stdin.write('y\n'); // Confirm generated abbreviation
  child.stdin.end();
}, 1000);

child.on('close', (code) => {
  console.log('Exit code:', code);
  console.log('Output length:', output.length);
});
EOF

node test-interactive.js
```

- [ ] **Step 4: Verify enhanced presenter naming**

```bash
grep "datasetPresenter name" tmp/PRJNA223552_presenter.xml
```

Expected: Name follows `orgAbbrev_Author_Year_rnaSeq_RSRC` or `orgAbbrev_Submitter_Year_rnaSeq_RSRC` format

- [ ] **Step 5: Clean up test files and commit validation**

```bash
rm -f test-interactive.js tmp/PRJNA223552_*
git add -A
git commit -m "test: validate complete organism abbreviation workflow

- End-to-end test with real BioProject data
- Verify interactive organism input functionality  
- Confirm enhanced presenter naming convention
- Validate integration with existing publication and BioProject data

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

### Task 8: Update Shared Resources and Documentation

**Files:**
- Modify: Root level documentation

- [ ] **Step 1: Sync shared resources to skills**

```bash
yarn sync-shared
```

Expected: `organism-abbreviations.csv` copied to skill resource directories

- [ ] **Step 2: Verify shared resource distribution**

```bash
find . -name "organism-abbreviations.csv" -type f
```

Expected: Multiple copies in different skill directories

- [ ] **Step 3: Update root README with organism abbreviation feature**

In `README.md`, find the RNA-seq skill description and update:

```markdown
- **curate-bulk-rnaseq**: Process bulk RNA-seq datasets - fetch SRA/GEO metadata, discover associated publications, lookup/generate organism abbreviations, analyze sample factors, generate presenter XML with enhanced naming convention and pipeline configurations
```

- [ ] **Step 4: Create organism abbreviation documentation**

```bash
cat > docs/organism-abbreviations.md << 'EOF'
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
EOF
```

- [ ] **Step 5: Commit documentation updates**

```bash
git add README.md docs/organism-abbreviations.md
git commit -m "docs: add organism abbreviation system documentation

- Update README with enhanced RNA-seq features
- Add comprehensive organism abbreviation documentation
- Explain reference data structure and maintenance
- Document abbreviation generation logic and usage

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```