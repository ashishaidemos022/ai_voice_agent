# Wren FAQ Two Fact Training Dataset

This experiment teaches two facts from `Wren_Restaurants_FAQ.pdf`: standard service hours and the gift-card policy. It contains eight supervised examples and two held-out tests.

In Viaana, open **Open Weight Lab**, select **Train**, upload `train.jsonl`, and use the settings in `heldout-tests.md`. After the job completes, enter each held-out question in the base-versus-adapter comparison.

This dataset is suitable for demonstrating weight adaptation. For a production restaurant assistant, keep facts that can change, such as opening hours, in the knowledge base and use retrieval so updates do not require retraining.
