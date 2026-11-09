# Evaluation

This file starts with retrieval. Answer quality, citation checks, abstention, and escalation are later steps. The dataset is `fixtures/retrieval/dataset.json`. Tests load it. Nothing in it is customer data or a secret.

## What the dataset checks

The embeddings are fixture axes, not `text-embedding-3-small`. Document `basis` 0 is a vector with `1` in dimension 0 and `0` elsewhere. A query lists the same kind of components. Cosine similarity is exact, and labels do not depend on a live model.

`asOf` is `2026-11-08`. The shared rank settings are top-k 5 and similarity `0.3`. One query sets top-k 2.

| Query               | What it holds still                                                      |
| ------------------- | ------------------------------------------------------------------------ |
| `single-shipping`   | One published current article.                                           |
| `multi-source`      | Two articles above the threshold, in score order.                        |
| `missing`           | No article on that axis.                                                 |
| `not-yet-effective` | Effective date after `asOf` drops the only match.                        |
| `draft-hidden`      | A current ready draft stays out.                                         |
| `retired-hidden`    | A retired row stays out.                                                 |
| `superseded-hidden` | A published row with `is_current = false` stays out.                     |
| `lexical-trap`      | Wording matches the returns article. The embedding matches shipping.     |
| `low-score`         | Similarity near `0.2` is dropped.                                        |
| `contradiction`     | Two current articles tie. Both come back, title order, no winner.        |
| `top-k`             | A third article is above the threshold and past the limit.               |
| `injection-is-text` | Chunk text is returned as data, including text that talks about filters. |
| `failed-hidden`     | Published and current is not enough when ingestion failed.               |

The Postgres test checks those labels. A second test stores the shipping vector in tenant A and tenant B and expects only tenant A's chunk. That test fails if the `document_chunks.tenant_id` predicate is removed, because both rows score the same and top-k is 5.

Every hit in the dataset test is read back from `document_chunks` and `documents`. The chunk id, document id, title, section, and text are the stored values.

## Why vector-only is enough for now

`lexical-trap` is the hybrid check. A word overlap of tokens of four letters or more ranks `returns` first. The fixture embedding ranks `shipping` first, which is the label. Adding keyword search on this set would change a correct result into the wrong article. The articles are short and share ordinary words such as "days", so an unweighted blend is not justified by this fixture.

Revisit hybrid when a sample of real `text-embedding-3-small` vectors shows a labeled miss that lexical search would fix. That belongs with the later evaluation step, not with this filter.

## Freshness and conflicts

An effective date in the future excludes the row. A null effective date does not. There is no expiry column, so an old date does not by itself retire a document. Superseded versions stay in the table and drop out because `is_current` is false. Retirement clears `is_current` as well.

When two current published articles both clear the threshold, retrieval returns both. It does not apply source precedence and it does not hide the disagreement. Choosing, abstaining, or escalating is the grounded-answer step. The evidence carries the document version and the effective date so that step can see them.

## Limits

- These vectors do not measure recall on real support wording. Two sentences about shipping are orthogonal unless the fixture says they share an axis.
- The dataset does not grade answers, citations, or abstention.
- Tenant isolation is the second integration test, not a row inside the single-tenant file.
- Prompt injection in a chunk is stored and returned as text. This step does not ask a chat model to obey or refuse it.
- Order lookup, human handoff, and provider failures are later datasets.
