-- ai-news-feed :: source expansion
-- Adds 8 high-signal RSS sources. All use the existing `rss` adapter — no new
-- adapter kinds. `on conflict (slug) do nothing` preserves any inline tweaks
-- an operator has made to pre-existing rows.

insert into sources (slug, name, kind, config, poll_interval_sec) values

-- ============== Labs & Infra (RSS) ==============
('stability-ai',    'Stability AI News',       'rss',
  '{"url":"https://stability.ai/news/rss.xml"}',                             7200),
('together-ai',     'Together AI Blog',        'rss',
  '{"url":"https://www.together.ai/blog/rss.xml"}',                          3600),
('perplexity-blog', 'Perplexity Blog',         'rss',
  '{"url":"https://www.perplexity.ai/rss.xml"}',                             3600),
('cerebras-blog',   'Cerebras Blog',           'rss',
  '{"url":"https://www.cerebras.net/blog/rss.xml"}',                         7200),
('databricks-ai',   'Databricks AI Blog',      'rss',
  '{"url":"https://www.databricks.com/blog/category/generative-ai/feed"}',   3600),

-- ============== Independent voices ==============
('simon-willison',  'Simon Willison''s Weblog', 'rss',
  '{"url":"https://simonwillison.net/atom/everything/"}',                    1800),
('jack-clark',      'Jack Clark — Import AI',   'rss',
  '{"url":"https://jack-clark.net/feed/"}',                                  21600),
('lesswrong-ai',    'LessWrong — AI (curated)', 'rss',
  '{"url":"https://www.lesswrong.com/feed.xml?view=curated-rss"}',           3600)

on conflict (slug) do nothing;
