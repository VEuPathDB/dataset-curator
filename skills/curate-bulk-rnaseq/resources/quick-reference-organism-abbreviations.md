# Quick Reference: Organism Abbreviations

## 🎯 Enhanced Presenter Naming Format

**`orgAbbrev_Author_Year_rnaSeq_RSRC`**

**Examples:**
- `fgraPH-1_Fagundes_2026_rnaSeq_RSRC` ← With publication
- `fgraPH-1_sichuanagr_2025_rnaSeq_RSRC` ← BioProject fallback

---

## 🔤 Abbreviation Generation Rules

**Format**: `${genus[0]}${species[0:3]}${strain}`

| **Input** | **Result** | **Breakdown** |
|-----------|------------|---------------|
| `Fusarium graminearum PH-1` | `fgraPH-1` | `f` + `gra` + `PH-1` |
| `Candida albicans strain A.1` | `calbA.1` | `c` + `alb` + `A.1` |
| `Escherichia coli isolate K-12` | `ecolK-12` | `e` + `col` + `K-12` |

---

## ⌨️ Interactive Input Tips

### ✅ **Good Organism Name Formats**
```
Fusarium graminearum PH-1
Saccharomyces cerevisiae S288C
Candida albicans strain A.1
Homo sapiens
```

### ❌ **Avoid These Formats**
```
F. graminearum          ← Use full genus name
baker's yeast           ← Use scientific name
Homo                    ← Include species
```

---

## 🔄 Workflow Quick Steps

### 1. **When Prompted for Organism**
```
Enter organism name: Fusarium graminearum
```
- Use **full scientific name**
- Include **strain if known** from metadata
- Check **SRA metadata** for organism hints

### 2. **CSV Lookup Results**
```
Found in database: fgraPH-1
Use 'fgraPH-1' as organism abbreviation? [Y/n]:
```
- Press **Enter** or **y** to accept
- Type **n** to provide custom abbreviation

### 3. **If Not Found**
```
Generated: fgraPH-1 (f + gra + PH-1)  
Use 'fgraPH-1' as organism abbreviation? [Y/n]:
```
- **Review generated abbreviation**
- Accept or provide custom alternative
- **Copy suggested CSV line** for future reference

---

## 📋 Strain Cleaning Rules

**Prefixes Removed:**
- `isolate ` → removed
- `strain ` → removed  
- `breed ` → removed
- `str. ` → removed

**Characters Preserved:**
- Dots: `A.1` stays `A.1`
- Hyphens: `K-12` stays `K-12`
- Slashes: `S/N` stays `S/N`
- All other special characters preserved

**Examples:**
```
"str. PH-1"        → "PH-1"
"isolate NRRL123"  → "NRRL123"
"strain A.1"       → "A.1"      ← preserves dot
"breed S/N"        → "S/N"      ← preserves slash
```

---

## 🔍 Attribution Logic

### **With Publications Found**
- **Author**: First author's last name
- **Year**: Publication year
- **Format**: `orgAbbrev_Smith_2024_rnaSeq_RSRC`

### **No Publications (BioProject Fallback)**
- **Submitter**: Cleaned organization name
- **Year**: Registration year  
- **Format**: `orgAbbrev_sichuanagr_2025_rnaSeq_RSRC`

**Submitter Cleaning:**
- `university` → `U`
- `college` → `C` 
- `institute` → `I`
- Remove special characters
- Max 10 characters

---

## 🆘 Common Issues

### **"CSV lookup failed"**
- **Check**: Organism reference file exists in root directory
- **File**: `Summary of VEupathDB Organism names and abbreviations - bld70.csv`

### **Unexpected Abbreviation**
- **Check**: Organism name spelling and format
- **Tip**: Include strain in input when available
- **Option**: Override with custom abbreviation

### **Wrong Reference Strain Used**
- **Cause**: Multiple strains in CSV, system picked wrong one
- **Solution**: Include specific strain in organism input

### **No Publications Found**
- **Expected**: System uses BioProject submitter as fallback
- **Normal**: Many datasets don't have associated publications

---

## 📚 Documentation Links

- **Full Guide**: [Organism Abbreviation Guide](organism-abbreviation-guide.md)
- **Migration**: [Migration Guide v2.0](migration-guide-v2.md)  
- **Step 4**: [Generate Presenter XML](step-4-generate-presenter.md)
- **Main Workflow**: [SKILL.md](../SKILL.md)