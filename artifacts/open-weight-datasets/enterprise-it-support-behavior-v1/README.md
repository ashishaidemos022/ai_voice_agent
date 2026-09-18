# Enterprise IT support behavior adapter v1

This dataset trains a behavior contract, not employee records or policy facts. The
adapter classifies the request, assigns priority, names required evidence, chooses
safe next actions, and states what it still needs. Live identity and device facts
come from `it_employees` / `it_assets`; approved procedure comes from retrieval over
`it_policy_articles`.

Recommended Tinker settings: Inkling-Small, rank 8, alpha 16, learning rate 0.0002,
24 steps, seed 42. Hold out paraphrases of LOST_DEVICE, ACCOUNT_COMPROMISE, and
ordinary hardware requests to verify both critical escalation and over-escalation.
