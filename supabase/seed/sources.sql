-- Seed 32 AI news sources. Safe to re-run (uses ON CONFLICT).
-- Dead-feed slugs from earlier versions are force-disabled at the bottom.

insert into sources (slug, name, kind, config, poll_interval_sec) values

-- ============== Labs & Official Blogs (RSS) ==============
('openai-blog',       'OpenAI Blog',           'rss',
  '{"url":"https://openai.com/blog/rss.xml"}',                  900),
-- Anthropic has no first-party RSS; these are community-maintained mirrors.
('anthropic-news',    'Anthropic News',        'rss',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml"}', 900),
('claude-blog',       'Claude Blog',           'rss',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml"}', 900),
('anthropic-engineering', 'Anthropic Engineering', 'rss',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml"}', 1800),
('deepmind-blog',     'Google DeepMind',       'rss',
  '{"url":"https://deepmind.google/blog/rss.xml"}',             900),
('google-ai-blog',    'Google AI',             'rss',
  '{"url":"https://blog.google/technology/ai/rss/"}',           900),
-- Meta AI removed its RSS feed; disabled until a replacement is found.
('microsoft-research','Microsoft Research',    'rss',
  '{"url":"https://www.microsoft.com/en-us/research/feed/"}',   1800),
('nvidia-blog',       'NVIDIA Blog',           'rss',
  '{"url":"https://blogs.nvidia.com/feed/"}',                   1800),
('hf-blog',           'Hugging Face Blog',     'rss',
  '{"url":"https://huggingface.co/blog/feed.xml"}',             1800),
-- Mistral has no first-party RSS; this is a community-maintained mirror.
('mistral-news',      'Mistral AI',            'rss',
  '{"url":"https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_mistral_news.xml"}', 1800),
-- Cohere, Stability AI, Perplexity, Cerebras: no public RSS as of 2026 — removed.
('together-ai',       'Together AI Blog',      'rss',
  '{"url":"https://www.together.ai/blog/rss.xml"}',             3600),
('databricks-ai',     'Databricks Blog',       'rss',
  '{"url":"https://www.databricks.com/feed"}',                  3600),

-- ============== Independent voices ==============
('simon-willison',    'Simon Willison''s Weblog', 'rss',
  '{"url":"https://simonwillison.net/atom/everything/"}',       1800),
('jack-clark',        'Jack Clark — Import AI',   'rss',
  '{"url":"https://jack-clark.net/feed/"}',                     21600),
('lesswrong-ai',      'LessWrong — AI (curated)', 'rss',
  '{"url":"https://www.lesswrong.com/feed.xml?view=curated-rss"}', 3600),

-- ============== arXiv ==============
('arxiv-cs-ai',       'arXiv cs.AI',           'arxiv',
  '{"category":"cs.AI"}', 3600),
('arxiv-cs-lg',       'arXiv cs.LG',           'arxiv',
  '{"category":"cs.LG"}', 3600),
('arxiv-cs-cl',       'arXiv cs.CL',           'arxiv',
  '{"category":"cs.CL"}', 3600),
('arxiv-cs-cv',       'arXiv cs.CV',           'arxiv',
  '{"category":"cs.CV"}', 3600),

-- ============== GitHub ==============
('github-trending-ai',     'GitHub Trending — AI',     'github_trending',
  '{"topic":"artificial-intelligence","since":"daily"}', 3600),
('github-trending-llm',    'GitHub Trending — LLM',    'github_trending',
  '{"topic":"llm","since":"daily"}', 3600),
('github-trending-agents', 'GitHub Trending — Agents', 'github_trending',
  '{"topic":"ai-agent","since":"daily"}', 3600),
('github-trending-mlops',  'GitHub Trending — ML',     'github_trending',
  '{"topic":"machine-learning","since":"weekly"}', 21600),

-- ============== Hugging Face ==============
('hf-models-trending',   'HF Trending Models',    'huggingface_models',
  '{"sort":"trendingScore"}',   3600),
('hf-datasets-trending', 'HF Trending Datasets',  'huggingface_datasets',
  '{"sort":"trendingScore"}',   7200),

-- ============== Community ==============
('hackernews-ai',  'Hacker News — AI',  'hackernews',
  '{"query":"artificial intelligence OR LLM OR GPT OR \"large language model\"","min_points":100}',
  1800),

-- ============== News & Funding ==============
('techcrunch-ai',      'TechCrunch AI',      'rss',
  '{"url":"https://techcrunch.com/category/artificial-intelligence/feed/"}', 1800),
('venturebeat-ai',     'VentureBeat AI',     'rss',
  '{"url":"https://venturebeat.com/category/ai/feed/"}',                    1800),
('mit-tech-review-ai', 'MIT Tech Review AI', 'rss',
  '{"url":"https://www.technologyreview.com/topic/artificial-intelligence/feed"}', 3600),
('the-verge-ai',       'The Verge — AI',     'rss',
  '{"url":"https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"}', 1800),

-- ============== Papers / Explainers ==============
-- Papers with Code was sunset in 2025 — removed.
('jay-alammar',        'Jay Alammar',           'rss',
  '{"url":"https://jalammar.github.io/feed"}',                              21600),
('the-gradient',       'The Gradient',          'rss',
  '{"url":"https://thegradient.pub/rss/"}',                                 21600)

on conflict (slug) do update set
  name              = excluded.name,
  kind              = excluded.kind,
  config            = excluded.config,
  poll_interval_sec = excluded.poll_interval_sec,
  enabled           = true;

-- Disable sources that were seeded by earlier versions but have since lost RSS.
-- Items already ingested stay in the DB but no more polling happens.
update sources set enabled = false where slug in (
  'meta-ai', 'cohere-blog', 'stability-ai', 'perplexity-blog',
  'cerebras-blog', 'papers-with-code'
);

-- Reputation weights (multiplies per-source dup contribution):
--   1.6  primary frontier labs (first-party announcements)
--   1.4  major infra/tooling labs and respected independents
--   1.2  curated aggregators / tier-1 journalism
--   1.0  community boards, github trending, hf trending (default)
--   0.8  broad tech journalism (often re-reports primary)

update sources set reputation_weight = 1.6 where slug in (
  'openai-blog', 'anthropic-news', 'claude-blog', 'deepmind-blog', 'google-ai-blog'
);

update sources set reputation_weight = 1.4 where slug in (
  'microsoft-research', 'nvidia-blog', 'hf-blog', 'mistral-news',
  'together-ai', 'databricks-ai', 'simon-willison', 'jack-clark',
  'anthropic-engineering'
);

update sources set reputation_weight = 1.2 where slug in (
  'mit-tech-review-ai', 'jay-alammar', 'the-gradient',
  'lesswrong-ai', 'arxiv-cs-ai', 'arxiv-cs-lg', 'arxiv-cs-cl', 'arxiv-cs-cv'
);

update sources set reputation_weight = 0.8 where slug in (
  'techcrunch-ai', 'venturebeat-ai', 'the-verge-ai'
);
