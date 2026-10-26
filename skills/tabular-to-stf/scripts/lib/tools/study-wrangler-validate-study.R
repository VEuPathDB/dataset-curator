# Loads a whole STF directory with study.wrangler and validates it the way the
# EDA does: geo variables inferred, then the baseline and eda profiles.
# Prints a STF_LOAD_ERROR or STF_VALIDATION marker line; exit 0 pass, 1 fail, 2 load error.
# Usage: Rscript study-wrangler-validate-study.R <stfDir>
suppressPackageStartupMessages(library(study.wrangler))
sink(stdout(), type = "message") # one stream, so the caller sees everything in order
dir <- commandArgs(trailingOnly = TRUE)[1]
profiles <- c("baseline", "eda")

study <- tryCatch(
  study_from_stf(dir, validate = FALSE),
  error = function(e) {
    cat("STF_LOAD_ERROR:", conditionMessage(e), "\n")
    quit(status = 2)
  }
)
study <- map_entities(study, infer_geo_variables_for_eda)
ok <- isTRUE(validate(study, profiles = profiles))
if (!ok) {
  # study-level validation hides the details of each entity's failures
  for (entity in get_entities(study)) {
    cat("== entity:", get_entity_name(entity), "==\n")
    validate(verbose(entity), profiles = profiles)
  }
}
cat(if (ok) "STF_VALIDATION: PASS\n" else "STF_VALIDATION: FAIL\n")
quit(status = if (ok) 0 else 1)
