# Controlled extraction test — SYNTHETIC notes

Run: 2026-10-02T05:23:56.718Z · extractors: forge-reference-extractor@1

| | forge-reference-extractor@1 |
| --- | --- |
| Correct candidates | 5 |
| False commitments | 0 |
| Missed commitments | 0 |
| Unsupported owner inference | 0 |
| Unsupported dates | 0 |
| Dates not read (left to the person) | 1 |
| Hallucinated dependencies | 0 |
| Classification errors | 1 |
| Findings removed by governance (quote not in notes) | 0 |
| Gold candidates | 5 |

Every candidate is INFERENCE until the synthetic reviewer confirms, edits or dismisses it; no commitment exists before that step (`commitmentsBeforeReview` is 0 in every run below).

```json
[
  {
    "meeting": "QC review (SYNTHETIC)",
    "gold": [
      {
        "quote": "failed seal inspection",
        "class": "DISCUSSION",
        "candidate": false
      },
      {
        "quote": "We should look at whether the transfer cost",
        "class": "DISCUSSION",
        "candidate": false
      },
      {
        "quote": "I will revise the transfer SOP",
        "class": "COMMITMENT",
        "candidate": true,
        "owner": "Supply Chain Director (SYNTHETIC)",
        "dueBy": "2026-10-30",
        "dependencies": []
      },
      {
        "quote": "I will re-inspect the two held units",
        "class": "COMMITMENT",
        "candidate": true,
        "owner": "Logistics Manager (SYNTHETIC)",
        "dueBy": "2026-10-23",
        "dependencies": [
          "replacement seals arrive"
        ]
      },
      {
        "quote": "Could you send me the re-labelling invoices",
        "class": "REQUEST",
        "candidate": false
      },
      {
        "quote": "I might ask Distributor D",
        "class": "INTENTION",
        "candidate": false
      },
      {
        "quote": "no further transfers from Distributor D",
        "class": "DECISION",
        "candidate": true,
        "owner": "Supply Chain Director (SYNTHETIC)",
        "dueBy": null,
        "dependencies": []
      }
    ],
    "by": {
      "forge-reference-extractor@1": {
        "model": null,
        "findings": [
          {
            "class": "DISCUSSION",
            "quote": "We should look at whether the transfer cost covered re-labelling.",
            "candidate": false,
            "notConverted": "Discussion binds nobody."
          },
          {
            "class": "COMMITMENT",
            "quote": "I will revise the transfer SOP to add a QC re-release step by 30 October.",
            "candidate": true,
            "notConverted": null
          },
          {
            "class": "COMMITMENT",
            "quote": "I will re-inspect the two held units and release them by 23 October, once the replacement seals arrive.",
            "candidate": true,
            "notConverted": null
          },
          {
            "class": "REQUEST",
            "quote": "Could you send me the re-labelling invoices?",
            "candidate": false,
            "notConverted": "A request is not a promise until someone accepts it."
          },
          {
            "class": "INTENTION",
            "quote": "I might ask Distributor D for their storage logs.",
            "candidate": false,
            "notConverted": "Tentative language is an intention, not a promise."
          },
          {
            "class": "DECISION",
            "quote": "Agreed: no further transfers from Distributor D until the SOP is revised. Owner: Minh.",
            "candidate": true,
            "notConverted": null
          }
        ],
        "score": {
          "correct": [
            "I will revise the transfer SOP to add a QC re-release step by 30 October.",
            "I will re-inspect the two held units and release them by 23 October, once the replacement seals arrive.",
            "Agreed: no further transfers from Distributor D until the SOP is revised. Owner: Minh."
          ],
          "falseCommitments": [],
          "missed": [],
          "unsupportedOwner": [],
          "unsupportedDate": [],
          "missedDate": [],
          "hallucinatedDependencies": [],
          "classificationErrors": [],
          "removedByGovernance": []
        },
        "person": {
          "confirmed": 3,
          "edited": 0,
          "dismissed": 0,
          "commitmentsBeforeReview": 0,
          "commitmentsAfterReview": 3
        }
      }
    },
    "disagreements": {}
  },
  {
    "meeting": "Commercial sync (SYNTHETIC)",
    "gold": [
      {
        "quote": "wants a written installation plan",
        "class": "DISCUSSION",
        "candidate": false
      },
      {
        "quote": "Can I get the purchase order numbers",
        "class": "REQUEST",
        "candidate": false
      },
      {
        "quote": "I'll send you the PO numbers by Wednesday",
        "class": "COMMITMENT",
        "candidate": true,
        "owner": "Commercial Director (SYNTHETIC)",
        "dueBy": "2026-10-21",
        "dependencies": []
      },
      {
        "quote": "I'll try to get the margin bridge",
        "class": "INTENTION",
        "candidate": false
      },
      {
        "quote": "Someone should probably call Customer R",
        "class": "DISCUSSION",
        "candidate": false
      },
      {
        "quote": "we hold the current price",
        "class": "DECISION",
        "candidate": false
      },
      {
        "quote": "I commit to sending Customer R the installation plan",
        "class": "COMMITMENT",
        "candidate": true,
        "owner": "Commercial Director (SYNTHETIC)",
        "dueBy": "2026-10-24",
        "dependencies": []
      },
      {
        "quote": "Finance will need the final quantities",
        "class": "DISCUSSION",
        "candidate": false
      }
    ],
    "by": {
      "forge-reference-extractor@1": {
        "model": null,
        "findings": [
          {
            "class": "COMMITMENT",
            "quote": "Thu, I'll send you the PO numbers by Wednesday.",
            "candidate": true,
            "notConverted": null
          },
          {
            "class": "INTENTION",
            "quote": "I'll try to get the margin bridge done by Friday, no promises.",
            "candidate": false,
            "notConverted": "Tentative language is an intention, not a promise."
          },
          {
            "class": "INTENTION",
            "quote": "Someone should probably call Customer R about the delay.",
            "candidate": false,
            "notConverted": "Tentative language is an intention, not a promise."
          },
          {
            "class": "DECISION",
            "quote": "Decided — we hold the current price until the end of the quarter.",
            "candidate": false,
            "notConverted": "Nobody in the notes stands behind it."
          },
          {
            "class": "COMMITMENT",
            "quote": "OK. I commit to sending Customer R the installation plan by 24 October.",
            "candidate": true,
            "notConverted": null
          }
        ],
        "score": {
          "correct": [
            "Thu, I'll send you the PO numbers by Wednesday.",
            "OK. I commit to sending Customer R the installation plan by 24 October."
          ],
          "falseCommitments": [],
          "missed": [],
          "unsupportedOwner": [],
          "unsupportedDate": [],
          "missedDate": [
            {
              "quote": "Thu, I'll send you the PO numbers by Wednesday.",
              "gold": "2026-10-21",
              "dueText": null
            }
          ],
          "hallucinatedDependencies": [],
          "classificationErrors": [
            {
              "quote": "Someone should probably call Customer R about the delay.",
              "said": "INTENTION",
              "gold": "DISCUSSION"
            }
          ],
          "removedByGovernance": []
        },
        "person": {
          "confirmed": 1,
          "edited": 1,
          "dismissed": 0,
          "commitmentsBeforeReview": 0,
          "commitmentsAfterReview": 2
        }
      }
    },
    "disagreements": {}
  }
]
```