# Agent design

## Four agents, not one prompt

A single large prompt asked to explore, drive, judge, and explain does all four
badly and cannot be debugged when it does. Forge splits the work by the kind of
judgement each step needs.

| Agent | Question | Model budget |
|---|---|---|
| Explorer | What journeys matter in this application? | one fast call |
| Operator | How do I execute this journey? | none |
| Reproducer | Does this failure happen every time? | none |
| Judge | Does the evidence support this finding? | one strong call |

Two of the four use no model at all. That is deliberate: mechanics and
measurement do not need reasoning, and putting a model in the loop there buys
latency, cost, and nondeterminism for nothing.

## Explorer

Input: a compact observation of the entry page. Never raw HTML.

```text
URL, title, HTTP status
Headings
Links, buttons, inputs (accessible names)
Condensed page text
Stated application goal, when given
```

Output is schema-validated (`explorerOutputSchema`) and then re-ranked by
`domain.rankJourneys`, which promotes journeys whose names touch business-value
keywords and demotes settings and legal pages. A model that is confident and
wrong cannot spend the whole run budget on a theme picker.

When no model is reachable, `heuristicJourneys` derives journeys from the page's
own affordances. It is deliberately boring. Its job is to keep a run useful, not
to be clever.

## Operator

The Operator executes one journey and uses no model at all.

```text
navigate to the entry path
fill every visible field with synthetic data
pick the control that best matches the journey
activate it (submit if a form was filled, otherwise click)
re-read the page and check for server or client errors
```

Two rules earn their place:

**Buttons outrank links, heavily.** A page with a form almost always also has a
navigation link containing the same words. Following that link looks like
success while testing nothing. A link back to the current path scores zero.

**Once fields are filled, only a button will do.** Falling back to a link would
abandon the input that was just entered.

If nothing on the page corresponds to the journey, the journey is *skipped*, not
failed. That is a discovery miss, and reporting it as an application defect
would be a false positive.

Values are synthetic and obviously so. Never real credentials.

## Failure classification

A failed journey is not a bug until something says which kind of failure it was.

```text
executor broke        → BROWSER_FAILURE     → agent_error
auth wall / 401 / 403 → AUTH_FAILURE        → environment
transport failure     → NETWORK_FAILURE     → environment
timeout               → TIMEOUT             → environment
429                   → ENVIRONMENT_FAILURE → environment
4xx / 5xx             → APPLICATION_BUG     → reproduce
console errors        → APPLICATION_BUG     → reproduce
nothing conclusive    → UNKNOWN             → reproduce
```

Only `APPLICATION_BUG` and `UNKNOWN` get reproduction budget. Rate limiting is
not a defect and should never reach a developer as one.

## Reproducer

The failing journey is re-run up to three times. The result is a count, not an
opinion:

```text
3 of 3  → confirmed_bug
1 of 3  → flaky, and the report says so
0 of 3  → unknown
```

Confidence is computed from that count and the strength of the runtime signal.
An intermittent failure is explicitly penalised.

## Judge

The Judge receives the trace, the failure class, the reproduction count, and the
console and network evidence. It writes the title, the summary, and optionally a
root cause.

It cannot change the verdict. After it answers:

```ts
classification = baseline.classification              // measured
severity       = baseline.severity                    // measured
confidence     = min(baseline.confidence, model.confidence)
```

The model can lower confidence. It cannot raise it, and it cannot promote a
flaky failure to a confirmed bug. If its response fails schema validation, the
rule-derived baseline is used unchanged and the finding records that it was
judged by rules.

## Model routing

`ModelProvider` is an interface with two implementations: Workers AI (no
external account) and any OpenAI-compatible endpoint, typically reached through
Cloudflare AI Gateway. Discovery routes to a fast model; judging routes to a
stronger one. Nothing in Forge is wired to a specific provider.

Model output is never trusted as JSON. `extractJson` pulls the first balanced
object out of whatever prose or code fence the model wrapped it in, and the
result goes through a zod schema before it can reach the database.

## The agent trace

The UI shows observations, actions, results, and evidence, with timestamps. It
does not show hidden model reasoning, and there is nothing to show: the model
makes two decisions per run, and both are recorded as their validated output.
The trace is an audit log of what happened, which is the thing a developer
actually needs.
