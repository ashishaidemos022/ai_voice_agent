# Wren FAQ Two Fact Training Dataset

This experiment teaches two facts from `Wren_Restaurants_FAQ.pdf`: standard service hours and the gift-card policy. It contains eight supervised examples and two held-out tests.

In Viaana, open **Open Weight Lab**, select **Train**, upload `train.jsonl`, and use the settings in `heldout-tests.md`. After the job completes, upload `heldout.jsonl` under **Evaluate & promote** and run the base-versus-adapter suite. Promotion unlocks only when the adapter passes every case and improves on the frozen base. Promotion fuses the LoRA delta into a standalone checkpoint and then re-runs the suite against base, adapter, and fused variants.

This dataset is suitable for demonstrating weight adaptation. For a production restaurant assistant, keep facts that can change, such as opening hours, in the knowledge base and use retrieval so updates do not require retraining.
