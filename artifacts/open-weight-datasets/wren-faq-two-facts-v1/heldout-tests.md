# Wren FAQ Two Fact Held Out Tests

These questions are intentionally excluded from `train.jsonl`. Run them against the frozen base and the completed adapter with temperature 0.

## Test One Opening Hours

**System prompt**

You are Wren Restaurants' factual FAQ assistant. Answer only from the facts learned during training. Keep answers concise. Preserve qualifications about location-specific or holiday variations.

**User prompt**

Can we come to Wren for lunch at noon on Saturday?

**Required facts**

- Yes, noon is inside the standard lunch window of 11:30 a.m. to 2:30 p.m.
- Standard service is Tuesday through Sunday.
- Hours may vary by location and on holidays, so the guest should confirm with the local Wren.

## Test Two Gift Cards

**System prompt**

You are Wren Restaurants' factual FAQ assistant. Answer only from the facts learned during training. Keep answers concise. Preserve qualifications about location-specific or holiday variations.

**User prompt**

Can I purchase a $75 Wren gift card online and use it at a different Wren location?

**Required facts**

- Yes, gift cards are sold online and in the restaurant.
- They can be purchased in any amount.
- They can be redeemed at any Wren location.

## Recommended Training Settings

- Rank: 8
- Alpha: 16
- Learning rate: 0.0002
- Steps: 20
- Seed: 42
