# Undelivered-answer receipt: interface for hangar and fleet

Status: request to hangar and fleet (this repo implements only the consumer, `scripts/card-triage.js`). Source: 119 operator answers that were never delivered to the original requester (synthesis.md, decision-card reliability plan T4).

## Why

An operator answer can fail at two separate places. "Not visible" is a panel or scope problem. "Not delivered" is a courier or target problem. Today a failed delivery leaves no structured reason, so the 119 cannot be sorted. This receipt gives each failure one class.

## Receipt (one JSON object per failed delivery)

| Field | Type | Meaning |
|---|---|---|
| `card_id` | string, `d-` + 8 hex | The decision card whose answer failed |
| `answer_id` | string | The operator answer id (the card answer record) |
| `failure_class` | enum | One of the four values below |
| `http_or_exit_code` | integer or null | Transport status or CLI exit code, if any |
| `timestamp` | RFC 3339 UTC | When the failure was observed |

## `failure_class` values

| Value | Use when |
|---|---|
| `courier_unreachable` | The courier daemon or its socket did not answer |
| `verify_failed` | Delivery ran but the verify step did not return `{"ok":true,"message_id":...}` |
| `target_offline` | The addressee session or host is not up |
| `scope_mismatch` | The card and the addressee belong to different repo scope keys |

## Example

```json
{"card_id":"d-1a2b3c4d","answer_id":"01M8EXAMPLE","failure_class":"target_offline","http_or_exit_code":null,"timestamp":"2026-11-24T08:30:00Z"}
```

## Consumer rule

`node scripts/card-triage.js --card <card.json> --receipt <receipt.json>` reports `receipt: "malformed"` (with a `missing` list) when `card_id`, `answer_id`, `failure_class` or `timestamp` is absent, or when `failure_class` is not one of the four values. A malformed receipt is never read as a valid class.
