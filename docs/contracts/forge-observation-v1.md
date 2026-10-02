# forge.observation.v1 — reporting execution to Forge

For a team whose system records work or its results — a tracker, an ERP, a warehouse, an HRIS — and wants Forge to
see it without Forge writing a connector for it. Decision and reasons: [ADR-0027](../adr/0027-the-open-door-for-execution-surfaces.md).

## What Forge does with it

Forge never asks for "progress". It asks four questions of every observation, and does nothing else with it:

| If the observation… | Forge records |
| --- | --- |
| is about a record a commitment is executed through, with `done`/`total` in its payload | activity on that link — never evidence |
| matches what a commitment said would prove it (system, event type, the very record, the values) | evidence — supporting, or contradicting when the same record says something else |
| is what a commitment was waiting on | the dependency settled |
| changes the world a commitment rests on (only for event types Forge reads as context) | a context change, and the principal is asked |

Everything is recorded as your system's fact, by your system's connector. Observations nothing waits for are kept on
the ledger anyway: a commitment proposed tomorrow may name one as its evidence.

## The request

```
POST <your Forge's observation endpoint>
Content-Type: application/json
Forge-Surface: erp
Forge-Timestamp: 1790000000
Forge-Signature: v1=<hex HMAC-SHA256(secret, "<Forge-Timestamp>.<raw body>")>
```

- `Forge-Surface` names your system; the secret Forge holds for it signs the body. You report **only your own
  records**: the envelope's `system` must be the surface that signed it.
- The timestamp is Unix seconds and must be within five minutes of Forge's clock.
- `helm`, `memoire` and `forge` are reserved: they have their own contracts.

```json
{
  "contract": "forge.observation.v1",
  "system": "erp",
  "observations": [
    {
      "id": "erp-evt-88123",
      "eventType": "shipment.posted",
      "objectRef": "SH-0042",
      "entityRef": "memoire:account:rohto-vn",
      "occurredAt": "2026-10-24T02:00:00Z",
      "summary": "Shipment SH-0042 posted: 12 units to Rohto HCMC",
      "payload": { "quantity": 12, "destination": "HCMC" },
      "url": "https://erp.example/shipments/SH-0042",
      "protection": []
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `id` | stable in your system, 1–200 characters. **Forge keeps each id once**: re-sending changes nothing |
| `eventType` | lower case, like `stock_transfer.received` |
| `objectRef` | the record it is about, as your system names it |
| `entityRef` | optional: the shared enterprise entity, when you know it |
| `occurredAt` | when it happened in the world (ISO 8601); not in the future |
| `summary` | your system's own words for what it recorded |
| `payload` | optional, flat: up to 50 strings, numbers, booleans or nulls — what commitments match on |
| `url` | optional, https |
| `protection` | optional: the sensitivity classes of the fact (`FINANCIAL_SENSITIVE`, `COMMERCIAL_CONFIDENTIAL`, `HR_RESTRICTED`, `STRATEGIC_RESTRICTED`). Forge carries them onto everything derived from it and never lowers them |

At most 500 observations per request. A batch is accepted whole or not at all.

## The answer

| Status | Meaning | Do |
| --- | --- | --- |
| 200 | received: `received` new, `alreadyHeld` re-sent, the `effects` on commitments, `unmatched` | nothing |
| 400 | malformed; the message lists what to fix, observation by observation | fix and send again |
| 401 | unknown surface, wrong signature, or a timestamp outside five minutes | do not retry this body |
| 403 | a system this surface may not speak for, or a reserved one | do not retry |
| 413 | more than 500 in one batch | split it |
| 503 | Forge could not record it now | retry with the same body — what was half done is finished, nothing is doubled |

## Try it

```bash
FORGE_SURFACE_SECRET=... node scripts/send-observation.mjs --url <endpoint> --surface erp observations.json
```

`scripts/send-observation.mjs` signs a file of observations exactly as above; it is a reference for adapters, not a
connector.
