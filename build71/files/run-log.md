# Build 71 RNA-seq run log

Orchestrator-level record of each dataset processed. Concerns raised by subagents are
recorded verbatim in `rnaseq-caveats.txt`; this file is the per-dataset summary.

Started: 2026-07-23. 32 datasets to process (2 excluded — see `rnaseq-skipped.txt`).
Subagent model: Sonnet.

| # | datasetName | Status | Samples | Strandedness | Concerns |
|---|-------------|--------|---------|--------------|----------|
| 1 | plinCAN1_plinCAN1_Clairet_2024_rnaSeq_RSRC | DONE | 16 | stranded | 1 — `transformant_line` factor judgement call, **verified CONFIRMED** vs GEO GSE236510 |

## Open workflow issues

- **PubMed MCP (row 1) — RESOLVED 2026-07-23.** Cause: the curator had not completed MCP auth when row 1 ran; the subagent correctly fell back to `WebFetch` and the output was fine. PubMed + bioRxiv MCP are now connected in the orchestrator session. It's still unconfirmed whether MCP propagates to every subagent, so Step 4 and the prompt template now say "try MCP first, fall back to WebFetch". No further action needed.
