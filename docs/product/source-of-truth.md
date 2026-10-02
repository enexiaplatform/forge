# FORGE — Canonical Product Source of Truth

**Commitment & Outcome Execution Infrastructure**

> This document is the north star. It defines the product identity, mission,
> philosophy, boundaries and long-term direction of Forge. It is intentionally
> not a feature specification, UI specification, database schema, technical
> architecture or implementation checklist. The engineering system uses it to
> understand what Forge is trying to become, then makes product and technical
> decisions that serve that vision.
>
> Recorded verbatim from the product owner on 2026-10-01. How the architecture
> answers each section is in [forge-architecture.md](../architecture/forge-architecture.md).

## 1. Why Forge Exists

Modern enterprises already have many systems for getting work done: Jira, Asana,
Monday, Microsoft Project, ServiceNow, ERP systems, CRM systems, spreadsheets,
email, chat, documents.

The problem is not the absence of task management.

The deeper problem is that organizations continuously make decisions, but lose the
connection between: why a decision was made, what was committed, who owned it,
what execution actually happened, and what outcome was produced.

A management decision may appear in one meeting. Its initiatives may live somewhere
else. Tasks live in another system. Evidence lives in email. Financial consequences
appear in ERP. Customer consequences appear in CRM.

Months later, management often cannot reliably reconstruct:

- What did we decide?
- Why?
- Who committed to what?
- What assumptions did we make?
- What actually happened?
- Why did the outcome differ?
- What should the organization learn from it?

Forge exists to close this gap.

## 2. Mission

Turn enterprise decisions into accountable commitments, observable execution,
measurable outcomes, and reusable organizational learning.

Forge should make it possible for an organization to trace

```text
Decision → Commitment → Execution → Evidence → Outcome → Learning
```

without requiring the enterprise to abandon the tools its people already use.

## 3. Product Identity

Forge is not primarily a project management application. Forge is not trying to
become a better Jira, Asana, Monday, Trello, or Microsoft Project. Those systems are
primarily designed around work objects such as task, ticket, project, sprint,
milestone.

Forge is management-centric. Its central object is the **Commitment**.

A commitment represents an accountable promise made by a person, team, or
organizational unit in response to a decision, objective, obligation, risk, or
opportunity. A commitment should answer questions such as:

- What outcome are we committing to?
- Why does it matter?
- Who owns it?
- By when?
- What resources or dependencies exist?
- What evidence proves completion?
- What happened in reality?
- What value was created, protected, delayed, or destroyed?

Tasks may exist underneath a commitment. But tasks are implementation details. The
management object is the commitment.

## 4. Position Inside the Helm Ecosystem

Forge belongs to a broader enterprise infrastructure. The current ecosystem consists
primarily of:

**Memoire — Commercial Intelligence & Execution.** Memoire understands commercial
reality: customers, accounts, opportunities, commercial activity, relationships,
pipeline, commercial momentum, quotations, forecast, customer and market context.

**Helm — Enterprise Management Infrastructure.** Helm transforms operating reality
into management understanding. Helm is centered around enterprise value, decisions,
authority, commitments, outcomes, evidence, scenarios, management learning.

**Forge — Commitment & Outcome Execution.** Forge bridges the gap between management
intent and actual execution.

```text
MEMOIRE
Commercial Reality
      ↓
HELM
Understand / Decide
      ↓
FORGE
Commit / Execute
      ↓
OUTCOME
      ↓
HELM
Learn / Adapt
```

Forge should strengthen Helm rather than become an unrelated standalone productivity
application. At the same time, Forge should remain useful enough to operate as a
coherent product surface.

## 5. The Fundamental Management Loop

```text
SENSE → UNDERSTAND → DECIDE → COMMIT → EXECUTE → OBSERVE → LEARN → SENSE
```

Forge primarily owns COMMIT → EXECUTE → OBSERVE OUTCOME. Helm primarily owns
UNDERSTAND, DECIDE, LEARN. Memoire and other operational systems contribute
execution reality. Future systems such as Sentinel contribute external sensing.

## 6. Core Management Primitives

Forge should be designed around a small number of durable concepts rather than an
ever-growing list of features.

- **Decision** — a choice that creates organizational intent. A decision may
  originate inside Helm or elsewhere.
- **Commitment** — a concrete promise to produce an outcome. A commitment is more
  meaningful than a task. It carries accountability.
- **Owner** — the person or organizational unit accountable for the commitment.
  Ownership is not merely assignment.
- **Dependency** — something whose state materially affects the ability to fulfill a
  commitment. Dependencies may exist inside or outside Forge.
- **Evidence** — observable information that supports whether progress or
  completion is real. Evidence may come from operational systems, documents, CRM,
  ERP, communication, human confirmation, APIs, external systems.
- **Outcome** — what actually happened. The outcome should be distinguishable from
  intended outcome, activity performed, task completed, output delivered. Forge
  should care about real-world results.
- **Variance** — the difference between intended and observed outcomes. Variance is
  highly valuable because it creates management learning.
- **Learning** — what the enterprise should remember from the relationship between
  context, commitment, execution, and outcome. Learning eventually feeds Helm's
  Management Genome.

## 7. Forge Is Outcome-Centric, Not Activity-Centric

Traditional work software can reward activity. Forge should care about outcomes. A
team completes 42 tasks. That does not necessarily mean the commitment succeeded.
Forge should distinguish:

```text
ACTIVITY   What was done
OUTPUT     What was produced
OUTCOME    What changed
VALUE      Why that change mattered
```

This distinction should influence the entire product.

## 8. Forge Should Not Become Another Closed System

The enterprise may already use Jira, Asana, Monday, Teams, Slack, SAP, Oracle,
Salesforce, ServiceNow, Google Workspace, Microsoft 365, custom applications.
Forge should not require customers to migrate all execution into Forge. A commitment
may be executed through external systems:

```text
Forge Commitment
       ↓
Jira Epic · Salesforce Opportunity · SAP Purchase Order · Memoire Activity · External project
```

Forge should understand and observe those execution surfaces. This supports the
larger Helm philosophy: *Native where differentiated. Open where customers already
have strong systems. Unified by Helm.*

## 9. Zero-Redundant-Entry Principle

Manual data entry should be treated as a last resort. A core ecosystem principle is:
**Capture once. Understand once. Use everywhere.**

If information already exists elsewhere in the Helm ecosystem, Forge should reuse it
rather than request it again. If a commitment originates from a Helm decision, a
Memoire account, a commercial opportunity, an enterprise entity, the relevant
context should flow with it. Forge should inherit context whenever possible. The
ideal priority is:

```text
1. Existing enterprise data
2. System events
3. Communication/document extraction
4. Derived or inferred information
5. Human confirmation
6. Manual entry
```

Users should increasingly manage exceptions rather than continuously maintain
databases.

## 10. Shared Enterprise Reality

Forge should not create a parallel universe of duplicated business objects. The
ecosystem is moving toward a Unified Enterprise Model. A customer should not
separately exist as MemoireCustomer, ForgeCustomer, HelmCustomer, FlowCustomer. It
should represent the same underlying enterprise entity viewed through different
product contexts. Similarly people, products, organizational units, initiatives,
markets, risks, decisions, financial values, commitments should be connected to
shared enterprise reality.

Forge therefore represents an execution view of enterprise reality, not a
disconnected task database.

## 11. Context Should Flow Automatically

Consider a Helm decision: *Expand strategic account A.* If this generates a Forge
commitment, Forge should ideally already understand Account A, decision context,
commercial value, decision owner, strategic priority, relevant products, market,
responsible organizational unit, known risks, related opportunities.

The user should add only the information that genuinely does not yet exist. This
principle should influence architecture and UX from the beginning.

## 12. Evidence Over Status Reporting

Forge should reduce dependence on humans manually reporting 20% / 50% / 75%
complete. Whenever possible, progress should be supported by evidence:

```text
Commitment: Complete customer technical evaluation
Evidence:   Customer approval received in Memoire

Commitment: Ship first order
Evidence:   ERP shipment record

Commitment: Hire Country Manager
Evidence:   HRIS employee activated
```

This does not mean all work can be automated. It means Forge should prefer
observable reality over self-reported status.

## 13. Commitment Is Not Binary

Real management is messy. A commitment may become fulfilled, partially fulfilled,
missed, superseded, cancelled, invalidated by changed context, intentionally
abandoned, delayed, re-scoped. Forge should preserve this reality rather than
forcing simplistic completion semantics. More importantly, Forge should preserve
**why** the state changed.

## 14. Execution Should Retain Decision Context

One of the major failures of modern enterprise software is context loss. A strategic
decision becomes a project. The project becomes tasks. Eventually workers see only
*Complete task X.* They no longer know *Why are we doing this?* Forge should
preserve lineage:

```text
Enterprise Objective → Decision → Commitment → Initiative / Work → Evidence → Outcome
```

A person should be able to navigate upward from execution to intent. Management
should be able to navigate downward from decision to reality.

## 15. Decision-to-Outcome Traceability

This is one of Forge's most important long-term advantages. The system should
eventually help answer questions such as:

- Which strategic decisions produced the expected outcomes?
- Which commitments repeatedly fail?
- Where do decisions lose fidelity during execution?
- Which dependencies create repeated delays?
- Which organizational units reliably deliver their commitments?
- Which assumptions repeatedly prove wrong?
- Which decisions consumed resources but created little enterprise value?
- What happened after management made a specific decision?

This is significantly more valuable than simply knowing whether tasks are overdue.

## 16. Relationship With Authority

Forge should not invent its own isolated permission philosophy. Management authority
is ultimately part of Helm: who can create a commitment, who may accept
responsibility, who can modify scope, who can commit budget, who can cancel, who can
approve a change, what requires escalation. Forge should eventually respect Helm's
Decision & Authority Runtime. AI agents must follow the same authority boundaries.

## 17. Relationship With Enterprise Value

Forge should eventually connect execution to enterprise value. A commitment may
affect revenue, margin, cash, customer value, risk, capacity, strategic position,
operational resilience, organizational capability. Not every commitment requires a
precise financial value. Forge should avoid fake precision. But management should
increasingly be able to understand *Why is this commitment important?* and *What
value was actually produced?*

## 18. Relationship With Helm Enterprise Memory

Forge should generate durable organizational memory. When a commitment concludes,
the enterprise should not forget what happened. Useful context can include:
Situation, Decision, Assumptions, Commitment, Dependencies, Execution, Evidence,
Outcome, Variance, Explanation, Learning. This information should feed Helm
Enterprise Memory and ultimately the Management Genome. Over time, the organization
should become better at managing because it can learn from its own execution
history.

## 19. Management Genome

The long-term ambition is larger than execution tracking. Across thousands or
millions of decisions and commitments, Helm should build a unique understanding of
how that particular enterprise operates:

```text
Situation → Evidence → Decision → Commitment → Execution → Outcome → Learning
```

Forge provides critical evidence for the latter half of this chain. Without Forge or
an equivalent commitment/outcome layer, Management Genome risks becoming
theoretical.

## 20. AI Philosophy

Forge should be AI-native, but AI should not exist merely as a chat box. AI should
reduce management friction. Possible responsibilities include understanding context,
extracting commitments from decisions, identifying dependencies, collecting
execution evidence, detecting variance, summarizing progress, detecting conflicting
information, identifying emerging risks, finding relevant historical precedents,
helping explain outcomes, suggesting management attention.

However: **AI inference is not enterprise truth by default.** The system should
distinguish between FACT, INFERENCE, ASSUMPTION, PREDICTION, RECOMMENDATION,
DECISION. This epistemic distinction is important.

## 21. Human-in-the-Loop by Exception

Humans should focus on judgment. The infrastructure should handle routine
synchronization and context propagation. Ask the human when evidence conflicts,
confidence is low, judgment is required, authority is required, context materially
changes, a consequential decision must be made. Do not ask humans merely because
software needs another field populated.

## 22. Forge Should Feel Lightweight Even If the Infrastructure Is Deep

The backend may eventually become sophisticated. The user's experience should not
feel like enterprise bureaucracy. Forge should avoid turning management discipline
into form filling. A user should experience clarity, context, accountability, focus,
reduced reporting burden — not endless fields, administrative maintenance,
duplicated information, artificial workflows. Complexity should live in the
infrastructure, not in the user's head.

## 23. Progressive Modeling

Do not require the enterprise to model everything before receiving value. Forge
should work with a simple commitment model first (Decision, Commitment, Owner,
Outcome). Enterprise modeling can deepen as the organization adopts the ecosystem
(Authority, Dependency, Resource, Risk, Evidence, Value, Capability, Process).
Architecture should support evolution without forcing complexity upfront.

## 24. External Systems Are First-Class Citizens

Forge should not treat integrations as second-class imports. An externally executed
work item can be just as valid as native Forge execution. Forge cares about
commitment state and outcome truth — not whether the work was done inside our UI.
This is fundamental to the open ecosystem strategy.

## 25. Native Forge Capabilities Should Exist Only Where They Add Distinctive Value

Forge may provide native execution experiences. But do not rebuild mature commodity
software merely to claim platform completeness. Before building a major capability,
ask: *Does owning this capability materially improve Commitment → Outcome
intelligence?* If not, integration may be preferable.

## 26. Product Boundary

Forge should NOT gradually become generic CRM, ERP, accounting software, chat
software, document editor, email client, HRIS, source-code management platform,
generic ticketing product. Those domains may provide execution evidence. Forge's job
remains: **Turn intent into accountable outcomes.**

## 27. Product Personality

Forge should feel serious, intelligent, operational, calm, precise,
management-grade. It should not feel like a gamified to-do list, a colorful
productivity toy, an AI demo, a dashboard factory. The product should communicate:
*This is where commitments become reality.*

## 28. Success Condition

Forge succeeds when management stops asking *"What happened to that decision?"*
because the organization can see

```text
WHY → DECISION → COMMITMENTS → OWNERSHIP → EXECUTION → EVIDENCE → OUTCOME → LEARNING
```

in one coherent management chain.

## 29. Relationship to the Larger Vision

The Helm ecosystem is not intended to become another closed enterprise software
suite. The long-term vision is an open enterprise management infrastructure capable
of understanding and coordinating native applications and existing external systems
through a shared enterprise model. Forge is one native application in that
infrastructure. Memoire understands commercial reality. Forge understands
commitments and execution. Future Sentinel understands external reality. External
systems contribute operational reality. Helm brings those realities together into
management truth.

## 30. The Core Thesis

> Organizations do not fail because they lack tasks. They fail because intent,
> accountability, execution, outcomes, and learning become disconnected.

Forge reconnects them. Its deepest value is not project management. Its deepest
value is **organizational execution memory**. And its ultimate role in Helm is to
ensure that enterprise management becomes a closed learning system:

```text
REALITY → UNDERSTANDING → DECISION → COMMITMENT → EXECUTION → OUTCOME → LEARNING → BETTER FUTURE DECISIONS
```

## Guidance to the Engineering Agent

Use this source of truth as the north star. Do not interpret it as a literal feature
checklist. Do not mechanically implement every concept at once. Instead: understand
the product deeply, infer a coherent architecture, choose appropriate technical
patterns, establish strong foundations, create the simplest viable expression of the
vision, preserve room for the system to evolve toward the long-term model.

- Favor coherent product behavior over superficial feature quantity.
- Favor reusable primitives over hard-coded workflows.
- Favor shared enterprise context over duplicated application data.
- Favor automation and inference over unnecessary manual entry.
- Favor evidence over self-reported status.
- Favor outcomes over activity.
- Favor interoperability over ecosystem lock-in.

And above all: **Do not build another project-management tool. Build the missing
execution layer between enterprise decisions and enterprise outcomes.**
