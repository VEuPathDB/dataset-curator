# Loads one STF entity with study.wrangler and validates it; exits 1 unless valid.
# Usage: Rscript study-wrangler-validate.R <entity.tsv> <entity.yaml>
suppressPackageStartupMessages(library(study.wrangler))
args <- commandArgs(trailingOnly = TRUE)
entity <- entity_from_stf(args[1], args[2])
quit(status = if (isTRUE(validate(entity))) 0 else 1)
