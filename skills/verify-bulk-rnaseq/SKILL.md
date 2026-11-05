---
name: verify-bulk-rnaseq
description: Data loading team - verify a merged bulk RNA-seq proposal before it loads. Claims it, runs validate-proposal (library type and depth, sample labels and runs across samplesheet, analysisConfig and STF, ApiCommonData's analysisConfig parser, study-wrangler STF validation, optional build fitness) with the validation workspace the data loader names, posts the report on the ticket, reviews warnings and presenter text with the user, prepares the manual delivery with prepare-delivery (settling organisms, writing final/, fromProvider/ and the STF corpus files), then mark-ready or request-revision
---

# Verify a Bulk RNA-seq Proposal

Follow [the verification procedure](resources/verify-procedure.md) step by
step. This page adds what is specific to bulk RNA-seq. The automated parts are
`validate-proposal.js` and `prepare-delivery.js`; the judgment part is yours
and the user's.

## Workspace

This type's directory under the validation root is `rnaseq-validation/`.

## Validate

The validators check library type and depth, sample labels and runs across
the samplesheet, `analysisConfig` and STF, ApiCommonData's `analysisConfig`
parser, and study-wrangler STF validation.

Depth, library type and consistency errors go back to the curator.

## Prepare the delivery

Besides `final/`, `fromProvider/` and `workspace/`, the delivery holds the
STF corpus files. prepare-delivery needs a due date on the ticket's `Build NN`
milestone: it picks the STF release month. Preprocess in `workspace/`.

## Review with the user

- Every warning in the report (the text says what can go wrong).
- SRA runs still resolve and any server paths exist (the validators read a
  proposal-time snapshot).
- Sample annotations read sensibly.
- The curator's notes on the ticket.
- Presenter text: `Proposals/<PROPOSAL>/curated/presenter.json` on
  `origin/master` (display name, summary, description, contacts).

Then decide, as the procedure says.

