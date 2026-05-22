-- ai-news-feed :: source registry seed.
--
-- Auto-applied by `supabase db reset` after migrations. To apply manually
-- in the Supabase SQL editor, run migrations 001 → 002 → 003 first.
--
-- This file is the single source of truth for which sources exist and how
-- they're configured. Every entry passed scripts/verify-sources.mjs at audit
-- time: reachable, parseable, items have titles + links, newest item ≤ 60d.
--
-- Safe to re-run — every INSERT has ON CONFLICT DO UPDATE, every disable
-- and weight update is idempotent.

insert into sources (slug, name, kind, region, config, poll_interval_sec) values

-- ============== Labs & Official Blogs (RSS) ==============
('openai-blog',           'OpenAI Blog',                  'rss', 'global',
  '{"url":"https://openai.com/blog/rss.xml"}',                                                       900),
-- Anthropic has no first-party RSS; these are community-maintained mirrors.
('anthropic-news',        'Anthropic News',               'rss', 'global',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml"}', 900),
('claude-blog',           'Claude Blog',                  'rss', 'global',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml"}',        900),
('anthropic-engineering', 'Anthropic Engineering',        'rss', 'global',
  '{"url":"https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml"}', 1800),
('deepmind-blog',         'Google DeepMind',              'rss', 'global',
  '{"url":"https://deepmind.google/blog/rss.xml"}',                                                  900),
('google-ai-blog',        'Google AI',                    'rss', 'global',
  '{"url":"https://blog.google/technology/ai/rss/"}',                                                900),
('microsoft-research',    'Microsoft Research',           'rss', 'global',
  '{"url":"https://www.microsoft.com/en-us/research/feed/"}',                                        1800),
('nvidia-blog',           'NVIDIA Blog',                  'rss', 'global',
  '{"url":"https://blogs.nvidia.com/feed/"}',                                                        1800),
('hf-blog',               'Hugging Face Blog',            'rss', 'global',
  '{"url":"https://huggingface.co/blog/feed.xml"}',                                                  1800),
-- Mistral has no first-party RSS; this is a community-maintained mirror.
('mistral-news',          'Mistral AI',                   'rss', 'global',
  '{"url":"https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_mistral_news.xml"}',    1800),
('together-ai',           'Together AI Blog',             'rss', 'global',
  '{"url":"https://www.together.ai/blog/rss.xml"}',                                                  3600),
('databricks-ai',         'Databricks Blog',              'rss', 'global',
  '{"url":"https://www.databricks.com/feed"}',                                                       3600),
('snowflake-ai',          'Snowflake AI Research',        'rss', 'global',
  '{"url":"https://www.snowflake.com/feed/"}',                                                       3600),
('replicate-blog',        'Replicate Blog',               'rss', 'global',
  '{"url":"https://replicate.com/blog/rss"}',                                                        3600),

-- ============== Researchers & Independent voices ==============
('simon-willison',        'Simon Willison''s Weblog',     'rss', 'global',
  '{"url":"https://simonwillison.net/atom/everything/"}',                                            1800),
('jack-clark',            'Jack Clark — Import AI',       'rss', 'global',
  '{"url":"https://jack-clark.net/feed/"}',                                                          21600),
('lesswrong-ai',          'LessWrong — AI (curated)',     'rss', 'global',
  '{"url":"https://www.lesswrong.com/feed.xml?view=curated-rss"}',                                   3600),
('bair-berkeley',         'Berkeley AI Research',         'rss', 'global',
  '{"url":"https://bair.berkeley.edu/blog/feed.xml"}',                                               21600),
('nvidia-developer',      'NVIDIA Technical Blog',        'rss', 'global',
  '{"url":"https://developer.nvidia.com/blog/feed/"}',                                               3600),
('sebastian-raschka',     'Ahead of AI (Raschka)',        'rss', 'global',
  '{"url":"https://magazine.sebastianraschka.com/feed"}',                                            21600),
('eugene-yan',            'Eugene Yan',                   'rss', 'global',
  '{"url":"https://eugeneyan.com/rss/"}',                                                            21600),

-- ============== Sources kept in registry but disabled (stale; see bottom) ==============
-- jay-alammar, lilian-weng, karpathy, chip-huyen, fast-ai, synced-review,
-- the-gradient — feeds parse but the newest item is older than the retention
-- window. Rows exist so a future maintainer can flip enabled=true if/when the
-- publisher resumes posting; no need to re-discover the URLs.
('jay-alammar',           'Jay Alammar',                  'rss', 'global',
  '{"url":"https://jalammar.github.io/feed"}',                                                       21600),
('lilian-weng',           'Lilian Weng',                  'rss', 'global',
  '{"url":"https://lilianweng.github.io/index.xml"}',                                                21600),
('karpathy',              'Andrej Karpathy',              'rss', 'global',
  '{"url":"https://karpathy.github.io/feed.xml"}',                                                   21600),
('chip-huyen',            'Chip Huyen',                   'rss', 'global',
  '{"url":"https://huyenchip.com/feed.xml"}',                                                        21600),
('fast-ai',               'fast.ai',                      'rss', 'global',
  '{"url":"https://www.fast.ai/index.xml"}',                                                         21600),
('synced-review',         'Synced',                       'rss', 'global',
  '{"url":"https://syncedreview.com/feed/"}',                                                        7200),
('the-gradient',          'The Gradient',                 'rss', 'global',
  '{"url":"https://thegradient.pub/rss/"}',                                                          21600),

-- ============== arXiv ==============
('arxiv-cs-ai',           'arXiv cs.AI',                  'arxiv', 'global', '{"category":"cs.AI"}',  3600),
('arxiv-cs-lg',           'arXiv cs.LG',                  'arxiv', 'global', '{"category":"cs.LG"}',  3600),
('arxiv-cs-cl',           'arXiv cs.CL',                  'arxiv', 'global', '{"category":"cs.CL"}',  3600),
('arxiv-cs-cv',           'arXiv cs.CV',                  'arxiv', 'global', '{"category":"cs.CV"}',  3600),
('arxiv-cs-ro',           'arXiv cs.RO (Robotics)',       'arxiv', 'global', '{"category":"cs.RO"}',  3600),
('arxiv-cs-ne',           'arXiv cs.NE',                  'arxiv', 'global', '{"category":"cs.NE"}',  3600),
('arxiv-cs-ir',           'arXiv cs.IR',                  'arxiv', 'global', '{"category":"cs.IR"}',  3600),
('arxiv-cs-hc',           'arXiv cs.HC',                  'arxiv', 'global', '{"category":"cs.HC"}',  3600),
('arxiv-stat-ml',         'arXiv stat.ML',                'arxiv', 'global', '{"category":"stat.ML"}', 3600),

-- ============== GitHub ==============
('github-trending-ai',     'GitHub Trending — AI',        'github_trending', 'global',
  '{"topic":"artificial-intelligence","since":"daily"}',                                             3600),
('github-trending-llm',    'GitHub Trending — LLM',       'github_trending', 'global',
  '{"topic":"llm","since":"daily"}',                                                                 3600),
('github-trending-agents', 'GitHub Trending — Agents',    'github_trending', 'global',
  '{"topic":"ai-agent","since":"daily"}',                                                            3600),
('github-trending-mlops',  'GitHub Trending — ML',        'github_trending', 'global',
  '{"topic":"machine-learning","since":"weekly"}',                                                   21600),
('github-trending-rag',    'GitHub Trending — RAG',       'github_trending', 'global',
  '{"topic":"rag","since":"daily"}',                                                                 7200),
('github-trending-vector', 'GitHub Trending — Vector',    'github_trending', 'global',
  '{"topic":"vector-database","since":"weekly"}',                                                    21600),
('github-trending-mcp',    'GitHub Trending — MCP',       'github_trending', 'global',
  '{"topic":"model-context-protocol","since":"weekly"}',                                             21600),

-- ============== Hugging Face ==============
('hf-models-trending',     'HF Trending Models',          'huggingface_models',   'global',
  '{"sort":"trendingScore"}',                                                                        3600),
('hf-datasets-trending',   'HF Trending Datasets',        'huggingface_datasets', 'global',
  '{"sort":"trendingScore"}',                                                                        7200),

-- ============== Community boards ==============
('hackernews-ai',          'Hacker News — AI',            'hackernews', 'global',
  '{"query":"artificial intelligence OR LLM OR GPT OR \"large language model\"","min_points":100}',  1800),

-- ============== News & Funding ==============
('techcrunch-ai',          'TechCrunch AI',               'rss', 'global',
  '{"url":"https://techcrunch.com/category/artificial-intelligence/feed/"}',                         1800),
('venturebeat-ai',         'VentureBeat AI',              'rss', 'global',
  '{"url":"https://venturebeat.com/category/ai/feed/"}',                                             1800),
('mit-tech-review-ai',     'MIT Tech Review AI',          'rss', 'global',
  '{"url":"https://www.technologyreview.com/topic/artificial-intelligence/feed"}',                   3600),
('the-verge-ai',           'The Verge — AI',              'rss', 'global',
  '{"url":"https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"}',                     1800),
('ars-technica-ai',        'Ars Technica — AI',           'rss', 'global',
  '{"url":"https://arstechnica.com/ai/feed/"}',                                                      1800),
('wired-ai',               'Wired — AI',                  'rss', 'global',
  '{"url":"https://www.wired.com/feed/tag/ai/latest/rss"}',                                          1800),
('the-register-ai',        'The Register — AI/ML',        'rss', 'global',
  '{"url":"https://www.theregister.com/software/ai_ml/headlines.atom"}',                             1800),
('zdnet-ai',               'ZDNet — AI',                  'rss', 'global',
  '{"url":"https://www.zdnet.com/topic/artificial-intelligence/rss.xml"}',                           3600),
('404-media',              '404 Media',                   'rss', 'global',
  '{"url":"https://www.404media.co/rss"}',                                                           3600),
('axios-ai',               'Axios — AI',                  'rss', 'global',
  '{"url":"https://api.axios.com/feed/tag/artificial-intelligence"}',                                1800),
('cnbc-tech',              'CNBC — Tech',                 'rss', 'global',
  '{"url":"https://www.cnbc.com/id/19854910/device/rss/rss.html"}',                                  3600),
('rest-of-world',          'Rest of World',               'rss', 'global',
  '{"url":"https://restofworld.org/feed/latest/"}',                                                  3600),

-- ============== Analyst newsletters ==============
('latent-space',           'Latent Space',                'rss', 'global',
  '{"url":"https://www.latent.space/feed"}',                                                         7200),
('interconnects',          'Interconnects — Lambert',     'rss', 'global',
  '{"url":"https://www.interconnects.ai/feed"}',                                                     7200),
('last-week-in-ai',        'Last Week in AI',             'rss', 'global',
  '{"url":"https://lastweekin.ai/feed"}',                                                            21600),
('ai-snake-oil',           'AI Snake Oil',                'rss', 'global',
  '{"url":"https://www.aisnakeoil.com/feed"}',                                                       21600),
('marcus-on-ai',           'Marcus on AI',                'rss', 'global',
  '{"url":"https://garymarcus.substack.com/feed"}',                                                  21600),
('the-decoder',            'The Decoder',                 'rss', 'global',
  '{"url":"https://the-decoder.com/feed/"}',                                                         3600),
('platformer',             'Platformer (Casey Newton)',   'rss', 'global',
  '{"url":"https://platformer.news/feed"}',                                                          3600),
('big-technology',         'Big Technology (Kantrowitz)', 'rss', 'global',
  '{"url":"https://www.bigtechnology.com/feed"}',                                                    3600),
('stratechery',            'Stratechery (Ben Thompson)',  'rss', 'global',
  '{"url":"https://stratechery.com/feed/"}',                                                         3600),
('one-useful-thing',       'One Useful Thing (Mollick)',  'rss', 'global',
  '{"url":"https://www.oneusefulthing.org/feed"}',                                                   7200),
('dont-worry-vase',        'Don''t Worry About the Vase (Zvi)', 'rss', 'global',
  '{"url":"https://thezvi.substack.com/feed"}',                                                      7200),
('dwarkesh-podcast',       'Dwarkesh Podcast',            'rss', 'global',
  '{"url":"https://www.dwarkesh.com/feed"}',                                                         7200),
('astral-codex-ten',       'Astral Codex Ten',            'rss', 'global',
  '{"url":"https://www.astralcodexten.com/feed"}',                                                   7200),
('the-generalist',         'The Generalist',              'rss', 'global',
  '{"url":"https://thegeneralist.substack.com/feed"}',                                               7200),

-- ============== Safety, EA, science ==============
('alignment-forum',        'Alignment Forum',             'rss', 'global',
  '{"url":"https://www.alignmentforum.org/feed.xml?view=curated-rss"}',                              7200),
('80000-hours',            '80,000 Hours',                'rss', 'global',
  '{"url":"https://80000hours.org/feed/"}',                                                          21600),
('ea-forum-ai',            'EA Forum — AI Curated',       'rss', 'global',
  '{"url":"https://forum.effectivealtruism.org/feed.xml?view=ai-curated&karmaThreshold=30"}',        7200),
('quanta-magazine',        'Quanta Magazine',             'rss', 'global',
  '{"url":"https://www.quantamagazine.org/feed/"}',                                                  7200),

-- ============== Robotics / engineering ==============
('robohub',                'Robohub',                     'rss', 'global',
  '{"url":"https://robohub.org/feed/"}',                                                             7200),
('ieee-spectrum-ai',       'IEEE Spectrum — AI',          'rss', 'global',
  '{"url":"https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss"}',                     3600),

-- ============== Vendor MLOps ==============
('weaviate-blog',          'Weaviate Blog',               'rss', 'global',
  '{"url":"https://weaviate.io/blog/rss.xml"}',                                                      7200),
('aws-ml-blog',            'AWS ML Blog',                 'rss', 'global',
  '{"url":"https://aws.amazon.com/blogs/machine-learning/feed/"}',                                   3600),
('cloudflare-ai',          'Cloudflare — AI',             'rss', 'global',
  '{"url":"https://blog.cloudflare.com/tag/ai/rss/"}',                                               3600),

-- ============== Crawler — VERIFIED (selectors live-tested) ==============
('anthropic-news-crawled',     'Anthropic News (first-party)',     'crawler', 'global',
  '{"base_url":"https://www.anthropic.com/news",
    "item_selector":"a[class*=\"PublicationList\"][class*=\"listItem\"]",
    "title_selector":"span[class*=\"title\"]",
    "date_selector":"time[class*=\"date\"]",
    "url_prefix":"https://www.anthropic.com",
    "max_items":50}',                                                                                1800),
('anthropic-research-crawled', 'Anthropic Research (first-party)', 'crawler', 'global',
  '{"base_url":"https://www.anthropic.com/research",
    "item_selector":"a[class*=\"PublicationList\"][class*=\"listItem\"]",
    "title_selector":"span[class*=\"title\"]",
    "date_selector":"time[class*=\"date\"]",
    "url_prefix":"https://www.anthropic.com",
    "max_items":50}',                                                                                3600),
('cerebras-crawled',           'Cerebras Blog (first-party)',      'crawler', 'global',
  '{"base_url":"https://www.cerebras.ai/blog",
    "item_selector":"a.flex.md\\:flex-col.to-md\\:gap-6",
    "title_selector":"h3, h2, [class*=\"title\"], [class*=\"heading\"]",
    "url_prefix":"https://www.cerebras.ai",
    "max_items":40}',                                                                                3600),

-- ============== Crawler — STUB (DISABLED below) ==============
-- RSS broken or page reachable but selectors not yet validated.
('ai21-blog-crawled',         'AI21 Labs Blog (crawl)',     'crawler', 'global',
  '{"base_url":"https://www.ai21.com/blog"}',                                                        7200),
('langchain-crawled',         'LangChain Blog (crawl)',     'crawler', 'global',
  '{"base_url":"https://blog.langchain.com/"}',                                                      7200),
('pinecone-crawled',          'Pinecone Blog (crawl)',      'crawler', 'global',
  '{"base_url":"https://www.pinecone.io/blog/"}',                                                    7200),
('anyscale-crawled',          'Anyscale Blog (crawl)',      'crawler', 'global',
  '{"base_url":"https://www.anyscale.com/blog"}',                                                    7200),
('lightning-ai-crawled',      'Lightning AI (crawl)',       'crawler', 'global',
  '{"base_url":"https://lightning.ai/blog/"}',                                                       7200),
('stanford-hai-crawled',      'Stanford HAI (crawl)',       'crawler', 'global',
  '{"base_url":"https://hai.stanford.edu/news"}',                                                    21600),
('anthropic-engineering-crawled', 'Anthropic Engineering (first-party)', 'crawler', 'global',
  '{"base_url":"https://www.anthropic.com/engineering"}',                                            3600),
('claude-com-blog-crawled',   'Claude.com Product Blog (crawl)', 'crawler', 'global',
  '{"base_url":"https://claude.com/blog"}',                                                          3600),
-- Need Playwright (JS-rendered SPAs / anti-bot 403s).
('xai-blog-crawled',          'xAI Blog (Playwright)',       'crawler', 'global',
  '{"base_url":"https://x.ai/blog","needs":"playwright"}',                                           3600),
('inflection-blog-crawled',   'Inflection AI (Playwright)',  'crawler', 'global',
  '{"base_url":"https://inflection.ai/blog","needs":"playwright"}',                                  7200),
('cohere-blog-crawled',       'Cohere Blog (Playwright)',    'crawler', 'global',
  '{"base_url":"https://cohere.com/blog","needs":"playwright"}',                                     7200),
('perplexity-crawled',        'Perplexity (Playwright)',     'crawler', 'global',
  '{"base_url":"https://www.perplexity.ai/hub","needs":"playwright"}',                               7200),
('stability-crawled',         'Stability AI (Playwright)',   'crawler', 'global',
  '{"base_url":"https://stability.ai/news","needs":"playwright"}',                                   7200)

on conflict (slug) do update set
  name              = excluded.name,
  kind              = excluded.kind,
  config            = excluded.config,
  region            = excluded.region,
  poll_interval_sec = excluded.poll_interval_sec,
  enabled           = true;

-- ============== Crawler config relocation ==============
-- The single INSERT above stashes crawler JSON in `config` for compactness,
-- but the crawler adapter (lib/ingest/crawler.ts) reads from `crawl_config`.
-- Move it. Idempotent on re-run, since `config` is re-populated by the ON
-- CONFLICT clause and then moved again here.
update sources
  set crawl_config = config,
      config       = '{}'::jsonb
  where kind = 'crawler';

-- ============== Disables ==============

-- Original-seed dead slugs: publishers removed their RSS. Force-disabled so
-- a future maintainer doesn't accidentally re-enable them.
update sources set enabled = false where slug in (
  'meta-ai', 'cohere-blog', 'stability-ai', 'perplexity-blog',
  'cerebras-blog', 'papers-with-code'
);

-- Crawler stubs without verified selectors + Playwright-required ones.
update sources set enabled = false where slug in (
  'ai21-blog-crawled', 'langchain-crawled', 'pinecone-crawled',
  'anyscale-crawled', 'lightning-ai-crawled', 'stanford-hai-crawled',
  'anthropic-engineering-crawled', 'claude-com-blog-crawled',
  'xai-blog-crawled', 'inflection-blog-crawled', 'cohere-blog-crawled',
  'perplexity-crawled', 'stability-crawled'
);

-- Stale publishers — feeds parse but newest item is past the 60d staleness
-- threshold, so every item gets pruned by the retention window on ingest.
-- Rows kept so URLs are preserved; flip enabled=true if the publisher
-- resumes posting.
--   chip-huyen      (490d)  jay-alammar (421d)  lilian-weng (385d)
--   synced-review   (280d)  karpathy    ( 98d)  fast-ai     ( 94d)
--   the-gradient    ( 91d)
update sources set enabled = false where slug in (
  'chip-huyen', 'jay-alammar', 'lilian-weng', 'synced-review',
  'karpathy', 'fast-ai', 'the-gradient'
);

-- Reddit subreddits — auth wall (403 unauth). Documented here so future maintainers
-- don't burn time re-discovering this. Rows present in case Reddit reverses.
update sources set enabled = false where slug in (
  'reddit-machinelearning', 'reddit-localllama', 'reddit-singularity',
  'reddit-artificial', 'reddit-aiengineer'
);

-- phil-schmid, gwern: no working RSS endpoint exists. See verifier history.
update sources set enabled = false where slug in (
  'phil-schmid', 'gwern'
);

-- ============== Reputation weights ==============
-- 1.6 primary frontier labs (first-party announcements)
-- 1.4 respected independents / safety orgs / labs' research blogs
-- 1.2 curated newsletters / institutional research
-- 1.0 default (community boards, github/hf trending)
-- 0.8 broad tech journalism (often re-reports primary)

update sources set reputation_weight = 1.6 where slug in (
  'openai-blog', 'anthropic-news', 'claude-blog', 'deepmind-blog', 'google-ai-blog',
  'snowflake-ai', 'replicate-blog', 'nvidia-developer',
  'aws-ml-blog', 'cloudflare-ai',
  'anthropic-news-crawled', 'anthropic-research-crawled', 'cerebras-crawled'
);

update sources set reputation_weight = 1.4 where slug in (
  'microsoft-research', 'nvidia-blog', 'hf-blog', 'mistral-news',
  'together-ai', 'databricks-ai', 'simon-willison', 'jack-clark',
  'anthropic-engineering',
  'sebastian-raschka', 'eugene-yan', 'latent-space', 'interconnects',
  'weaviate-blog',
  'alignment-forum', 'bair-berkeley',
  'platformer', 'big-technology', 'stratechery',
  'one-useful-thing', 'dont-worry-vase', 'dwarkesh-podcast',
  '80000-hours'
);

update sources set reputation_weight = 1.2 where slug in (
  'mit-tech-review-ai', 'lesswrong-ai',
  'arxiv-cs-ai', 'arxiv-cs-lg', 'arxiv-cs-cl', 'arxiv-cs-cv',
  'arxiv-cs-ro', 'arxiv-cs-ne', 'arxiv-cs-ir', 'arxiv-cs-hc', 'arxiv-stat-ml',
  'last-week-in-ai', 'ai-snake-oil', 'marcus-on-ai', 'the-decoder',
  'robohub', 'ieee-spectrum-ai',
  'astral-codex-ten', 'the-generalist', '404-media', 'quanta-magazine',
  'rest-of-world', 'ea-forum-ai'
);

update sources set reputation_weight = 0.8 where slug in (
  'techcrunch-ai', 'venturebeat-ai', 'the-verge-ai',
  'ars-technica-ai', 'wired-ai', 'the-register-ai', 'zdnet-ai',
  'axios-ai', 'cnbc-tech'
);
