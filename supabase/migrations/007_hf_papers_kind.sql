-- ai-news-feed :: huggingface_papers source kind
--
-- HuggingFace Daily Papers (https://huggingface.co/api/daily_papers) is a
-- community-curated short list of ~50 trending AI papers per day with
-- upvotes — exactly the "meaningful papers" signal arXiv's chronological
-- firehose can't provide, and available immediately (no S2 indexing lag).
--
-- Safe to re-run.

alter type source_kind add value if not exists 'huggingface_papers';
