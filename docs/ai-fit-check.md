# AI plant fit check

A home types the name of a plant it is thinking of buying. The app answers with a verdict (`good_fit`, `caution` or `poor_fit`), reasons tied to the household profile and the plants it already owns, warnings such as "toxic to cats", and up to three look-alike plants that suit the home better. Each alternative has an "Add this plant" button that opens the add-plant form pre-filled.

This page describes how it works, why the main decisions were made, what the eval measured, and where it falls short.

## How a check runs

```mermaid
flowchart TD
  page["/plants/check page"] -->|POST candidate| route["POST /api/fit-check"]
  route --> run["runFitCheck"]
  run -->|"20 or more today?"| quota[("fit_checks")]
  quota -->|yes| r429["429"]
  run --> load["load profile, owned plants, catalog match<br/>(Turso)"]
  load --> evaluate["evaluateFitCheck"]
  load --> alts["alternatives"]
  evaluate --> call["structuredCall<br/>OpenRouter, Haiku 4.5, strict JSON schema"]
  call --> zod["Zod validation"]
  zod --> guard["guardrail<br/>(catalog plants only)"]
  alts --> sql["stage A: SQL hard filters + look similarity"]
  sql -.->|"ALTERNATIVES_MODE = 'rerank' (off)"| rerank["stage B: model re-ranks the top 10"]
  guard --> log["log to fit_checks"]
  sql --> merge["response body"]
  rerank -.-> merge
  log --> merge
  merge --> page
```

- The route needs a home cookie. It maps results to statuses: quota used up is 429, a refusal is 422, an unusable answer is 502, and a provider error or an unreadable quota count is 503.
- `runFitCheck` (`src/lib/server/ai/run-fit-check.ts`) checks the quota, loads the data, runs the model call and the alternatives in parallel, logs the check and builds the response. The fields `data_source`, `species_id` and `alternatives` are set by code and never by the model.
- `evaluateFitCheck` (`fit-check.ts`) has no database access. It calls `structuredCall`, which sends the request, checks the finish reason, the refusal flag, the content type and then the Zod schema. The deterministic guardrail runs after that.
- The quota is 20 checks per home per UTC day. Refused and invalid answers are logged with verdict `error` and count toward it, because they were paid for. A provider error is not logged and does not count, so an outage does not use up a home's quota.
- Candidate text is trimmed and capped at 100 characters.

### The guardrail

For a catalog plant, after the model has answered:

- **Pets.** If the plant is toxic to a pet the home has, the verdict cannot be `good_fit` (it becomes `poor_fit`), and a toxicity warning naming that pet must be present. Missing ones are appended.
- **Small kids.** If the home has small kids and the plant is toxic to cats or dogs, a toxicity warning that mentions children must be present. It is appended if missing. The verdict is not forced.

The guardrail does not apply to plants that are not in the catalog, because there are no trusted facts to check against. For those, only the model and the prompt stand between the user and a wrong answer, and the UI marks the result as unverified.

### Alternatives

Stage A is plain SQL. Hard filters remove the candidate itself, plants the home already owns, plants toxic to a pet the home has (or to cats or dogs when the home has small kids), plants needing more care or light than the home gives, and low-drought-tolerance plants for homes that travel. The rest are scored on look (growth habit 3, leaf size 2, leaf shape 2, variegated 1), anything under 3 is dropped, and the top 3 are returned with a templated explanation. A plant that fails a filter can never come back, whatever its score.

Stage B asks the model to pick 2 or 3 from the SQL top 10 and explain each in a sentence. It can only choose ids from that list, and anything else is dropped in code. If the call fails or fewer than 2 valid picks remain, the SQL top 3 is used. Stage B is built and tested but switched off (`ALTERNATIVES_MODE = 'sql'` in `run-fit-check.ts`). See the results below.

## Decisions

| Topic                 | Chosen                                                                                                                | Alternatives considered                                                             | Why                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Provider              | OpenRouter through `@openrouter/sdk`                                                                                  | `openai` SDK pointed at OpenRouter; Anthropic API direct; Workers AI; Vercel AI SDK | One funded account, one key, a usage dashboard and per-key spend limits.                                                |
| Model                 | `anthropic/claude-haiku-4.5` for every LLM call                                                                       | Opus, Sonnet, non-Claude models                                                     | Cheapest Claude option and already doing the job. The eval checks it meets the bar. There is no multi-model comparison. |
| Output format         | Strict JSON schema (`requireParameters: true`) plus Zod validation                                                    | "Reply in JSON" and parse; forced tool use                                          | Schema-guided generation cuts malformed output. Zod still guards the boundary.                                          |
| Context               | Everything in one prompt: profile, owned plants, catalog row                                                          | Vector-store RAG; the model calling the database                                    | The data per home is tiny. RAG would add infrastructure for no gain.                                                    |
| Fact source           | A hand-built catalog of 50 plants. Unknown plants fall back to model knowledge, flagged "unverified"                  | Web search at runtime; the model filling the catalog on a miss                      | Repeatable facts for common plants, predictable cost.                                                                   |
| Profile               | Structured fields plus a notes box (500 characters)                                                                   | Free text only; pets and care level only                                            | Can be validated, renders cleanly into the prompt, supports rule-based pre-fill.                                        |
| Profile pre-fill      | SQL rules over the owned plants joined to the catalog                                                                 | The model suggests values; manual only                                              | Free, instant, explainable.                                                                                             |
| Alternatives          | Stage A in SQL. Stage B (re-rank) built but off                                                                       | The model suggests freely; SQL only                                                 | Hard filters make unsafe suggestions impossible, and the staging gave a measurable before and after.                    |
| Kids safety           | ASPCA cat and dog toxicity as a proxy                                                                                 | A `toxic_to_humans` column; ignore kids                                             | See below.                                                                                                              |
| Plant to catalog link | Name match on scientific name, common name and aliases, ignoring case. "Add this plant" pre-fills the scientific name | A `species_id` column on `plants`                                                   | `plants` stays unchanged, and the scientific name is the only unique one.                                               |

### The kids proxy

The catalog has no human-toxicity column. A plant that is toxic to cats or dogs counts as unsafe around small kids. The common houseplant toxins (calcium oxalate, saponins) affect people too, and the rule only removes plants, so it errs on the safe side. It is a proxy, not medical advice, and it will exclude some plants that are harmless to people.

### Settings that are deliberate

- No `temperature`, `reasoning` or `effort`. Haiku 4.5 does not support `effort`. Consistency comes from the schema, a versioned prompt, the pinned model id and the eval.
- No prompt caching. The system prompt is far below Haiku 4.5's 4096-token minimum prefix, so `cache_control` would do nothing.
- Both prompts are versioned (`PROMPT_VERSION`, `RERANK_PROMPT_VERSION`) and every logged check records the fit-check version. Change a prompt, bump the version, rerun the eval.
- The re-rank sees catalog data and the structured profile fields only. Home notes are free text and are kept out of that call.

## Eval

`pnpm eval:fit-check` runs 20 cases against the real model and scores each run. It builds an in-memory catalog from `scripts/catalog-seed-data.json`, so it touches no database. `pnpm eval:fit-check --alternatives` compares stage A with stage B. Each full run costs money, so neither is part of `pnpm test`. Results are committed in `evals/fit-check/results/`.

The 20 cases (`evals/fit-check/cases.json`) cover pets with catalog and non-catalog toxic plants, small kids, low care commitment, low light, travel, clear good fits, an invented plant name, and two prompt injections in the notes field.

### Fit check, `fit-check-v2`, 60 runs (20 cases, 3 runs each)

| Measure                     | Result          |
| --------------------------- | --------------- |
| Schema-valid answers        | 100%            |
| Verdict in the expected set | 100%            |
| Required warnings, final    | 100%            |
| Required warnings, raw      | 100%            |
| Guardrail fired             | 0%              |
| Average tokens in and out   | 1400 and 159    |
| Average cost per check      | $0.00219        |
| Latency p50 and p95         | 2.0 s and 2.8 s |

The first run, on `fit-check-v1`, scored 98.3% on final warnings. One of 60 runs, an oleander check for a home with small kids, put the toxicity and the children in two separate warnings, which the matcher does not accept. The guardrail cannot help there because oleander is not in the catalog. One sentence in the prompt (each warning must name who is at risk) fixed it, and the second run was clean. One miss in 60 runs is within noise, so the fix is supported by one clean run and not by a proven rate.

Cost is about a third of the $0.006 the plan estimated, so a home using its whole daily quota of 20 checks costs about $0.04.

### Alternatives, stage A and stage B, `rerank-v1`, 48 runs

| Measure                  | A (SQL top 3) | B (re-rank) |
| ------------------------ | ------------- | ----------- |
| Alternatives per check   | 2.13          | 1.98        |
| Mean similarity (0 to 8) | 4.85          | 4.87        |
| Hard-filter violations   | 0             | 0           |

For B: 0% invalid picks, 0% fallbacks, and a re-rank call in only 18 of the 48 runs (the rest had a shortlist of 3 or fewer). Each call used about 1182 tokens in and 93 out, cost $0.00165 and took 1.9 s. Averaged over every check that is $0.00062 and 0.7 s, and the latency runs in parallel with the fit check.

Where B ran it mostly returned the same plants as A, sometimes two instead of three, and its picks varied between runs. It adds a model call without a measured gain in similarity or safety, so it stays off. The eval does not measure the one thing B could improve, the quality of the explanation text.

## Known limits

- **The catalog is small and unreviewed against sources.** It has 50 plants. The `source_url` column is empty because the seed data has no URLs, so no toxicity fact in it has been checked against a primary source yet. That review is manual and still to do.
- **Stage A often finds little.** With 50 plants, the hard filters and the minimum similarity, 8 of the 16 catalog cases got fewer than 3 alternatives and 2 got none. A bigger catalog or a lower threshold would change that.
- **Plants outside the catalog are unverified.** The model answers from general knowledge and the guardrail does not run. The UI says so, and the eval has only 4 such cases.
- **Name matching is exact.** There is no fuzzy matching. "Monstera" works because it is an alias, "monstara" does not. One alias, "split-leaf philodendron", belongs to two species, and the lowest id wins when an owned plant is matched.
- **The kids rule is a pet-toxicity proxy** (see above).
- **The eval is small and written by the author.** It has 20 cases, 3 runs each, one model, and 5 cases accept two verdicts. It supports "no known failures", not "safe".
- **Prompt injection has light coverage.** User text is escaped, the system prompt says to treat the notes as data, the output is schema-bound, and nothing the model says is executed or stored beyond the log row. Only two eval cases attack it.
- **Anyone can create a home**, so the AI routes are open to the public. The per-home quota and the spend limit on the OpenRouter key are the protection against cost abuse.
- **The re-rank is not logged and does not count toward the quota** when it is switched on. Its cost is only measured by the eval.
- **Not built yet:** identifying a plant from a photo, and an LLM judge for the free-text summary.
