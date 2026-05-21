// Stack — main React app
// Screens: feed (home), cluster (drill-in detail), onboarding overlay
// Filter by topic via pill rail in the nav.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ---------- Helpers ----------
function hoursAgoLabel(h) {
  if (h < 1) return 'just now';
  if (h === 1) return '1h ago';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1d ago' : `${d}d ago`;
}

function plural(n, s, p) { return n === 1 ? s : (p || s + 's'); }

// Reveal-on-scroll: returns true once the element enters the viewport.
function useInView(ref, opts = {}) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        obs.disconnect();
      }
    }, { threshold: 0.06, rootMargin: '0px 0px -60px 0px', ...opts });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return inView;
}

// Smoothed scrollY via requestAnimationFrame.
function useScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      setY(window.scrollY || window.pageYOffset || 0);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener('scroll', onScroll, { passive: true });
    tick();
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return y;
}

// ---------- Source avatar ----------
function SourceAvatar({ source, small, onHover, onLeave }) {
  const sz = small ? 18 : 22;
  const textColor = source.text || '#fff';
  return (
    <span
      className="src"
      style={{
        background: source.color,
        color: textColor,
        width: sz,
        height: sz,
        fontSize: sz <= 18 ? 9 : 10,
        borderWidth: sz <= 18 ? 1.5 : 2,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={source.name}
    >
      {source.initial}
    </span>
  );
}

// ---------- Rotating thumbnail ----------
function RotatingThumb({ sources, paused }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (paused || sources.length < 2) return;
    const t = setInterval(() => setIdx(i => (i + 1) % sources.length), 4200);
    return () => clearInterval(t);
  }, [sources.length, paused]);

  return (
    <div className="thumb" onClick={(e) => { e.stopPropagation(); setIdx(i => (i + 1) % sources.length); }}>
      {sources.map((s, i) => {
        const hue = s.thumb.hue;
        return (
          <div
            key={i}
            className={`thumb__layer ${i === idx ? 'on' : ''}`}
            style={{
              background: `linear-gradient(140deg,
                oklch(0.48 0.16 ${hue}) 0%,
                oklch(0.32 0.14 ${hue + 25}) 55%,
                oklch(0.18 0.10 ${hue + 50}) 100%)`,
            }}
          >
            <div className="thumb__source">{s.name}</div>
            <div className="thumb__label">{s.thumb.label}</div>
          </div>
        );
      })}
      <div className="thumb__dots">
        {sources.map((_, i) => <span key={i} className={i === idx ? 'on' : ''} />)}
      </div>
    </div>
  );
}

// ---------- Source hover preview ----------
function SourcePreview({ source, x, y }) {
  return (
    <div className="src-preview" style={{ left: x, top: y }}>
      <div className="src-preview__src">
        <SourceAvatar source={source} small />
        <span>{source.name} · {hoursAgoLabel(source.hoursAgo)}</span>
      </div>
      <div>{source.headline}</div>
    </div>
  );
}

// ---------- Cluster card ----------
function ClusterCard({ cluster, hero, variant, onOpen, index }) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(null); // { source, x, y }
  const topic = window.TOPICS.find(t => t.id === cluster.topic);
  const cardRef = useRef(null);

  const handleSrcHover = (source, e) => {
    if (!cardRef.current) return;
    const cardRect = cardRef.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left - cardRect.left + r.width / 2 - 140;
    const y = r.top - cardRect.top - 12 - 110; // ~tooltip height above
    setHover({ source, x: Math.max(8, x), y: Math.max(8, y) });
  };
  const handleSrcLeave = () => setHover(null);

  return (
    <article
      className="cluster"
      data-hero={hero || undefined}
      data-variant={variant || undefined}
      ref={cardRef}
      style={{ animationDelay: `${Math.min(index || 0, 6) * 60}ms` }}
    >
      <div className="cluster__head">
        <span className="cluster__topic">{topic?.label}</span>
        <span className="cluster__head__sep">·</span>
        <span className="cluster__head__time">{hoursAgoLabel(cluster.hoursAgo)}</span>
        {cluster.breaking && (
          <>
            <span className="cluster__head__sep">·</span>
            <span className="cluster__head__badge">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
              Breaking
            </span>
          </>
        )}
        <span className="cluster__head__spacer" />
      </div>

      <h2 className="cluster__title" onClick={() => onOpen(cluster.id)} style={{ cursor: 'pointer' }}>
        {cluster.headline}
      </h2>

      <div className="cluster__body">
        <RotatingThumb sources={cluster.sources} paused={expanded} />
        <p className="cluster__summary">{cluster.summary}</p>
      </div>

      <div className="cluster__foot">
        <div className="sources">
          {cluster.sources.slice(0, 5).map((s, i) => (
            <SourceAvatar
              key={i}
              source={s}
              onHover={(e) => handleSrcHover(s, e)}
              onLeave={handleSrcLeave}
            />
          ))}
        </div>
        <div className="cluster__count">
          Covered by <b>{cluster.sources.length}</b> {plural(cluster.sources.length, 'outlet')}
        </div>
        <span className="cluster__head__sep">·</span>
        <div className="cluster__readtime">{cluster.readMin} min read</div>
        <button
          className="cluster__expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Hide sources' : 'View sources'}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="expanded">
          <div className="expanded__head">All coverage · {cluster.sources.length} sources</div>
          {cluster.sources.map((s, i) => (
            <div className="src-row" key={i}>
              <SourceAvatar source={s} />
              <div className="src-row__src">{s.name}</div>
              <div className="src-row__head">{s.headline}</div>
              <div className="src-row__time">{hoursAgoLabel(s.hoursAgo)}</div>
            </div>
          ))}
        </div>
      )}

      {hover && <SourcePreview source={hover.source} x={hover.x} y={hover.y} />}
    </article>
  );
}

// ---------- Mini cluster (sidebar row) ----------
function MiniCluster({ cluster, onOpen, index }) {
  const topic = window.TOPICS.find(t => t.id === cluster.topic);
  const lead = cluster.sources[0];
  return (
    <article
      className="mini"
      style={{ animationDelay: `${(index || 0) * 60}ms` }}
      onClick={() => onOpen(cluster.id)}
    >
      <div className="mini__thumb">
        <div
          className="thumb__layer on"
          style={{
            background: `linear-gradient(140deg,
              oklch(0.48 0.16 ${lead.thumb.hue}) 0%,
              oklch(0.32 0.14 ${lead.thumb.hue + 25}) 55%,
              oklch(0.18 0.10 ${lead.thumb.hue + 50}) 100%)`,
          }}
        >
          <div className="thumb__source">{lead.name}</div>
          <div className="thumb__label">{lead.thumb.label}</div>
        </div>
      </div>
      <div className="mini__body">
        <div>
          <div className="mini__head">
            <span className="mini__topic">{topic?.label}</span>
            <span className="mini__sep">·</span>
            <span>{hoursAgoLabel(cluster.hoursAgo)}</span>
            {cluster.breaking && (
              <>
                <span className="mini__sep">·</span>
                <span style={{ color: 'var(--accent)' }}>Breaking</span>
              </>
            )}
          </div>
          <h3 className="mini__title" style={{ marginTop: 4 }}>{cluster.headline}</h3>
        </div>
        <div className="mini__foot">
          <div className="sources">
            {cluster.sources.slice(0, 3).map((s, i) => <SourceAvatar key={i} source={s} small />)}
          </div>
          <span>{cluster.sources.length} outlets</span>
        </div>
      </div>
    </article>
  );
}

// ---------- Detail page (full cluster) ----------
function ClusterDetail({ cluster, onBack }) {
  const topic = window.TOPICS.find(t => t.id === cluster.topic);
  return (
    <div>
      <div className="crumb">
        <button onClick={onBack}>← Briefing</button>
        <span className="crumb__sep">/</span>
        <span style={{ color: 'var(--accent)' }}>{topic?.label}</span>
        <span className="crumb__sep">/</span>
        <span>Cluster</span>
      </div>

      <div className="detail-head">
        <div className="cluster__head">
          <span className="cluster__topic">{topic?.label}</span>
          <span className="cluster__head__sep">·</span>
          <span className="cluster__head__time">{hoursAgoLabel(cluster.hoursAgo)}</span>
          {cluster.breaking && (
            <>
              <span className="cluster__head__sep">·</span>
              <span className="cluster__head__badge">
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
                Breaking
              </span>
            </>
          )}
        </div>

        <h1 className="detail-title">{cluster.headline}</h1>

        <p className="detail-summary">{cluster.summary}</p>

        <div className="detail-strip">
          <div className="sources">
            {cluster.sources.map((s, i) => <SourceAvatar key={i} source={s} />)}
          </div>
          <div className="cluster__count">
            Synthesized from <b>{cluster.sources.length}</b> sources
          </div>
          <span className="cluster__head__sep">·</span>
          <div className="cluster__readtime">{cluster.readMin} min read</div>
        </div>
      </div>

      <div className="detail-section-title">Every angle, every source</div>

      <div className="detail-grid">
        {cluster.sources.map((s, i) => (
          <div className="story" key={i}>
            <div className="story__thumb">
              <div
                className="thumb__layer on"
                style={{
                  background: `linear-gradient(140deg,
                    oklch(0.48 0.16 ${s.thumb.hue}) 0%,
                    oklch(0.32 0.14 ${s.thumb.hue + 25}) 55%,
                    oklch(0.18 0.10 ${s.thumb.hue + 50}) 100%)`,
                }}
              >
                <div className="thumb__source">{s.name}</div>
                <div className="thumb__label">{s.thumb.label}</div>
              </div>
            </div>
            <div className="story__src">
              <SourceAvatar source={s} small />
              <span>{s.name}</span>
            </div>
            <h3 className="story__head">{s.headline}</h3>
            <div className="story__meta">
              <span>{hoursAgoLabel(s.hoursAgo)}</span>
              <span>Read →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Onboarding ----------
function Onboarding({ onDone, initial }) {
  const [picked, setPicked] = useState(new Set(initial || ['ai', 'startups', 'dev']));
  const toggle = (id) => {
    setPicked(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const topics = window.TOPICS.filter(t => t.id !== 'all');
  return (
    <div className="onb-mask" onClick={onDone}>
      <div className="onb" onClick={e => e.stopPropagation()}>
        <div>
          <div className="onb__eyebrow">Welcome to Stack</div>
          <h2 className="onb__title">Tech news,<br/>bundled across every outlet.</h2>
        </div>
        <p className="onb__sub">
          We cluster stories by topic so you read each one <i>once</i> — not five times in five tabs. Pick what you care about and we'll tune your morning brief.
        </p>
        <div>
          <div className="onb__count" style={{ marginBottom: 10 }}>Choose your interests · {picked.size} selected</div>
          <div className="onb__topics">
            {topics.map(t => (
              <button
                key={t.id}
                className="topic-chip"
                aria-pressed={picked.has(t.id)}
                onClick={() => toggle(t.id)}
              >
                <span className="topic-chip__check">✓</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="onb__footer">
          <button className="btn-link" onClick={onDone}>Skip for now</button>
          <button
            className="btn-primary"
            disabled={picked.size === 0}
            onClick={() => onDone(Array.from(picked))}
          >
            Read my brief
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Top nav ----------
function Nav({ topic, setTopic, theme, setTheme, onLogo, onShowOnb, scrolled }) {
  return (
    <nav className={`nav${scrolled ? ' scrolled' : ''}`}>
      <div className="nav__inner">
        <div className="brand" onClick={onLogo}>
          <span className="brand__mark">S</span>
          <span className="brand__name">stack<span className="brand__dot">.</span></span>
        </div>
        <div className="nav__pills">
          {window.TOPICS.map(t => (
            <button
              key={t.id}
              className="pill"
              aria-pressed={topic === t.id}
              onClick={() => setTopic(t.id)}
            >
              <span className="pill__dot" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav__actions">
          <button className="icon-btn" title="Search" aria-label="Search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <button className="icon-btn" title="Edit interests" onClick={onShowOnb} aria-label="Interests">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5l1.8 4.2L14 6.3l-3.2 2.8.9 4.4L8 11.4l-3.7 2.1.9-4.4L2 6.3l4.2-.6L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="icon-btn"
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Theme"
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13 9a5 5 0 1 1-6-6 4 4 0 0 0 6 6z" fill="currentColor"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3" fill="currentColor"/>
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}

// ---------- Briefing header ----------
function BriefingHeader({ visibleCount, topic, scrollY }) {
  const now = new Date(2026, 4, 20); // Wed, May 20, 2026
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const topicLabel = window.TOPICS.find(t => t.id === topic)?.label || 'All';
  const totalSources = window.CLUSTERS.reduce((acc, c) => acc + c.sources.length, 0);
  const totalRead = window.CLUSTERS.reduce((acc, c) => acc + c.readMin, 0);

  // Parallax fade — drift down + fade as you scroll past it.
  const k = Math.min(Math.max(scrollY / 320, 0), 1);
  const style = {
    opacity: 1 - k * 0.85,
    transform: `translateY(${k * -28}px)`,
  };

  return (
    <header className="briefing" style={style}>
      <div>
        <h1 className="briefing__greet">Your brief</h1>
        <div className="briefing__meta">
          <span>{dateStr}</span>
          <span className="cluster__head__sep">·</span>
          <span>Showing <b>{topicLabel}</b></span>
        </div>
      </div>
      <div className="briefing__stats">
        <div><b>{visibleCount}</b><span>clusters</span></div>
        <div><b>{topic === 'all' ? totalSources : '—'}</b><span>sources</span></div>
        <div><b>{topic === 'all' ? totalRead : '—'}</b><span>min read</span></div>
      </div>
    </header>
  );
}

// ---------- Tweaks ----------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "dark": true,
  "accent": "#f5a73c"
}/*EDITMODE-END*/;

const ACCENT_PRESETS = [
  { hex: '#f5a73c', oklch: 'oklch(0.78 0.15 60)' },   // amber
  { hex: '#4d9dff', oklch: 'oklch(0.72 0.15 245)' },  // electric blue
  { hex: '#5fd1a4', oklch: 'oklch(0.78 0.13 160)' },  // mint
  { hex: '#e96ad6', oklch: 'oklch(0.72 0.18 330)' },  // magenta
];

function findAccentOklch(hex) {
  return ACCENT_PRESETS.find(p => p.hex === hex)?.oklch || 'oklch(0.78 0.15 60)';
}

// ---------- App root ----------
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [topic, setTopic] = useState('all');
  const [detailId, setDetailId] = useState(null);
  const [showOnb, setShowOnb] = useState(() => {
    try { return !localStorage.getItem('stack.onb'); } catch (e) { return true; }
  });
  const scrollY = useScrollY();

  // Scroll progress — fraction of the document scrolled.
  const docMax = typeof document !== 'undefined'
    ? Math.max(1, (document.documentElement.scrollHeight - window.innerHeight))
    : 1;
  const progress = Math.min(100, (scrollY / docMax) * 100);
  const showToTop = scrollY > 600;

  // Apply theme + accent to root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    const oklch = findAccentOklch(t.accent);
    document.documentElement.style.setProperty('--accent', oklch);
    document.documentElement.style.setProperty('--accent-soft',
      oklch.replace(')', ' / 0.14)'));
  }, [t.dark, t.accent]);

  const onOnbDone = (interests) => {
    setShowOnb(false);
    try { localStorage.setItem('stack.onb', '1'); } catch (e) {}
  };

  const filtered = useMemo(() => {
    if (topic === 'all') return window.CLUSTERS;
    return window.CLUSTERS.filter(c => c.topic === topic);
  }, [topic]);

  const detail = detailId ? window.CLUSTERS.find(c => c.id === detailId) : null;

  // Scroll to top on view change
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [detailId]);

  return (
    <>
      <div className="progress" aria-hidden="true">
        <div className="progress__fill" style={{ width: `${progress}%` }} />
      </div>

      <Nav
        topic={topic}
        setTopic={(id) => { setTopic(id); setDetailId(null); }}
        theme={t.dark ? 'dark' : 'light'}
        setTheme={(th) => setTweak('dark', th === 'dark')}
        onLogo={() => { setDetailId(null); setTopic('all'); }}
        onShowOnb={() => setShowOnb(true)}
        scrolled={scrollY > 8}
      />

      <main className="shell">
        {detail ? (
          <ClusterDetail cluster={detail} onBack={() => setDetailId(null)} />
        ) : (
          <>
            <BriefingHeader visibleCount={filtered.length} topic={topic} scrollY={scrollY} />
            {filtered.length === 0 ? (
              <div className="empty">No clusters in this topic right now. <b>Check back soon.</b></div>
            ) : filtered.length >= 4 ? (
              <>
                <div className="home">
                  <ClusterCard
                    cluster={filtered[0]}
                    hero
                    onOpen={setDetailId}
                    index={0}
                  />
                  <div className="sidebar">
                    {filtered.slice(1, 4).map((c, i) => (
                      <MiniCluster
                        key={c.id}
                        cluster={c}
                        onOpen={setDetailId}
                        index={i + 1}
                      />
                    ))}
                  </div>
                </div>
                {filtered.length > 4 && (
                  <>
                    <div className="section-title">More briefs</div>
                    <div className="grid">
                      {filtered.slice(4).map((c, i) => (
                        <ClusterCard
                          key={c.id}
                          cluster={c}
                          variant="compact"
                          onOpen={setDetailId}
                          index={i + 4}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="grid">
                {filtered.map((c, i) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    variant="compact"
                    onOpen={setDetailId}
                    index={i}
                  />
                ))}
              </div>
            )}
            <div className="endbar">— end of today's brief —</div>
          </>
        )}
      </main>

      <button
        className={`to-top${showToTop ? ' show' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
        title="Back to top"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {showOnb && <Onboarding onDone={onOnbDone} />}

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakToggle
          label="Dark mode"
          value={t.dark}
          onChange={(v) => setTweak('dark', v)}
        />
        <TweakColor
          label="Accent"
          value={t.accent}
          options={ACCENT_PRESETS.map(p => p.hex)}
          onChange={(v) => setTweak('accent', v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
