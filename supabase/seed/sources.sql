-- Seed 25+ AI news sources. Safe to re-run (uses ON CONFLICT).

insert into sources (slug, name, kind, config, poll_interval_sec) values

-- ============== Labs & Official Blogs (RSS) ==============
('openai-blog',       'OpenAI Blog',           'rss',
  '{"url":"https://openai.com/blog/rss.xml"}',                  900),
('anthropic-news',    'Anthropic News',        'rss',
  '{"url":"https://www.anthropic.com/news/rss.xml"}',           900),
('deepmind-blog',     'Google DeepMind',       'rss',
  '{"url":"https://deepmind.google/blog/rss.xml"}',             900),
('google-ai-blog',    'Google AI',             'rss',
  '{"url":"https://blog.google/technology/ai/rss/"}',           900),
('meta-ai',           'Meta AI',               'rss',
  '{"url":"https://ai.meta.com/blog/rss/"}',                    900),
('microsoft-research','Microsoft Research',    'rss',
  '{"url":"https://www.microsoft.com/en-us/research/feed/"}',   1800),
('nvidia-blog',       'NVIDIA Blog',           'rss',
  '{"url":"https://blogs.nvidia.com/feed/"}',                   1800),
('hf-blog',           'Hugging Face Blog',     'rss',
  '{"url":"https://huggingface.co/blog/feed.xml"}',             1800),
('mistral-news',      'Mistral AI',            'rss',
  '{"url":"https://mistral.ai/news/feed.xml"}',                 1800),
('cohere-blog',       'Cohere Blog',           'rss',
  '{"url":"https://cohere.com/blog/rss.xml"}',                  1800),

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
('reddit-localllama',     'r/LocalLLaMA',      'reddit',
  '{"subreddit":"LocalLLaMA","min_score":50}', 1800),
('reddit-machinelearning','r/MachineLearning', 'reddit',
  '{"subreddit":"MachineLearning","min_score":80}', 1800),
('reddit-singularity',    'r/singularity',     'reddit',
  '{"subreddit":"singularity","min_score":200}', 1800),
('reddit-openai',         'r/OpenAI',          'reddit',
  '{"subreddit":"OpenAI","min_score":100}', 1800),

-- ============== News & Funding ==============
('techcrunch-ai',      'TechCrunch AI',      'rss',
  '{"url":"https://techcrunch.com/category/artificial-intelligence/feed/"}', 1800),
('venturebeat-ai',     'VentureBeat AI',     'rss',
  '{"url":"https://venturebeat.com/category/ai/feed/"}',                    1800),
('mit-tech-review-ai', 'MIT Tech Review AI', 'rss',
  '{"url":"https://www.technologyreview.com/topic/artificial-intelligence/feed"}', 3600),
('the-verge-ai',       'The Verge — AI',     'rss',
  '{"url":"https://www.theverge.com/ai-artificial-intelligence/rss/index.xml"}', 1800),

-- ============== Papers / Explainers ==============
('papers-with-code',   'Papers with Code',      'rss',
  '{"url":"https://paperswithcode.com/latest/feed"}',                       3600),
('jay-alammar',        'Jay Alammar',           'rss',
  '{"url":"https://jalammar.github.io/feed"}',                              21600),
('the-gradient',       'The Gradient',          'rss',
  '{"url":"https://thegradient.pub/rss/"}',                                 21600)

on conflict (slug) do update set
  name              = excluded.name,
  kind              = excluded.kind,
  config            = excluded.config,
  poll_interval_sec = excluded.poll_interval_sec;
