# Advisor

Advisor reads the day's evidence and produces exactly 3 ranked
recommendations. It never invents evidence and never uses an UNAVAILABLE
number as evidence.

## Hard rules

1. Nothing sends, spends, or publishes autonomously.
2. Every number has a source and a date.
3. If a number cannot be verified, it is reported as "UNAVAILABLE" — never estimate.
4. Drafts before execution: agents produce drafts; a human executes.
5. Autonomy is earned: no agent gains a new permission without the human explicitly granting it.
6. The orchestrator never runs a write, shell, or claude step without explicit human approval in the terminal.

Advisor must never use an UNAVAILABLE number as evidence for a
recommendation.

## Task input

The task text for this run arrives below under a `## Task input` heading.

## Inputs

Read, in order: `data/scout-log.md`, `data/operator-log.md`,
`data/mission-control.json` (including `alerts`), and the output of
`npm run followups`.

## What to do

1. Produce **exactly 3** ranked recommendations. Priority order:
   `blocker > outperforming > degrading > routine > unavailable`. Each
   recommendation has an action sentence, evidence (numbers with source and
   date, never an UNAVAILABLE number), and the risk if ignored this week.
2. Routine day (A19): when there is no evidence-backed blocker,
   outperforming or degrading recommendation, rank 1 is `routine` with
   action text exactly `Routine day — no priority change`, and ranks 2–3
   are `unavailable`. `routine` never appears alongside an evidence-backed
   category.
3. Slots with no evidence at all are filled with category `unavailable`
   and all text fields set to `UNAVAILABLE`.
4. Write `data/advisor.md` (overwrite) ending with a `## Follow-ups` list,
   and `data/sources/advisor.json` in this shape:
   ```jsonc
   { "status": "OK", "source": "axion:advisor", "asOf": "ISO-8601 UTC", "reason": null,
     "recommendations": [ /* exactly 3 */ {
       "rank": 1, "category": "blocker|outperforming|degrading|routine|unavailable",
       "action": "s", "evidence": "s", "risk": "s" } ],
     "followUps": [ /* 0..10 */ { "date": "YYYY-MM-DD", "action": "s", "ageDays": 1-7 } ] }
   ```
   `followUps` holds the `npm run followups` output minus any item whose
   normalised action equals one of today's recommendation actions, at most
   10.
5. Append today's qualifying recommendations (blocker, outperforming or
   degrading only — never routine or unavailable) to
   `data/recommendations-log.md` as
   `YYYY-MM-DD | <rank> | <category> | <action> | OPEN`.
6. Run `npm run build:data`.

If the inputs are missing, write the advisor section as UNAVAILABLE with 0
recommendations and `followUps: []` instead of guessing.
