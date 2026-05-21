// Stack — sample cluster data.
// Each cluster is a topic bucket with N source articles. The "summary" is the
// synthesized cross-source recap; individual source headlines live in `sources`.

window.TOPICS = [
  { id: 'all',       label: 'All' },
  { id: 'ai',        label: 'AI' },
  { id: 'startups',  label: 'Startups' },
  { id: 'hardware',  label: 'Hardware' },
  { id: 'dev',       label: 'Dev tools' },
  { id: 'security',  label: 'Security' },
  { id: 'bigtech',   label: 'Big tech' },
  { id: 'crypto',    label: 'Crypto' },
  { id: 'science',   label: 'Science' },
];

// Source palette — distinct colors per outlet so the stacked avatars read at a glance.
const S = {
  verge:     { initial: 'V', name: 'The Verge',     color: '#FF3D00' },
  tc:        { initial: 'T', name: 'TechCrunch',    color: '#0a9847' },
  wired:     { initial: 'W', name: 'Wired',         color: '#000000' },
  ars:       { initial: 'A', name: 'Ars Technica',  color: '#ff4e16' },
  bloomberg: { initial: 'B', name: 'Bloomberg',     color: '#1d2855' },
  reuters:   { initial: 'R', name: 'Reuters',       color: '#FF7900' },
  info:      { initial: 'I', name: 'The Info',      color: '#9d1f3a' },
  strat:     { initial: 'S', name: 'Stratechery',   color: '#5C2D91' },
  plat:      { initial: 'P', name: 'Platformer',    color: '#1f9aa3' },
  sifted:    { initial: 'Σ', name: 'Sifted',        color: '#00c2a8' },
  reg:       { initial: 'R', name: 'The Register',  color: '#cc0000' },
  decrypt:   { initial: 'D', name: 'Decrypt',       color: '#5b4eff' },
  nat:       { initial: 'N', name: 'Nature',        color: '#3a8b3a' },
  ft:        { initial: 'F', name: 'FT',            color: '#fff1e5', text: '#33302e' },
  semi:      { initial: '∴', name: 'SemiAnalysis',  color: '#222b3d' },
  bench:     { initial: 'β', name: 'Benchmark',     color: '#7e4cff' },
};

window.SOURCES = S;

window.CLUSTERS = [
  {
    id: 'gpt5',
    topic: 'ai',
    headline: 'OpenAI ships GPT-5 with native agentic tool use',
    summary:
      'OpenAI dropped GPT-5 at its dev day, with built-in tool calling, persistent memory across sessions, and a 2M-token context window. API pricing fell 40% from GPT-4o, and Microsoft is rolling it into Copilot this week. Early benchmarks have it edging Claude 4.5 on agentic tasks but trailing slightly on long-form reasoning.',
    hoursAgo: 2,
    readMin: 4,
    sources: [
      { ...S.verge,     headline: 'GPT-5 is here, and it changes how agents are built', hoursAgo: 2, thumb: { hue: 220, label: 'GPT-5 keynote · dev day' } },
      { ...S.tc,        headline: 'OpenAI slashes API pricing 40% with GPT-5 launch',   hoursAgo: 3, thumb: { hue: 140, label: 'Pricing chart · 2024–2026' } },
      { ...S.info,      headline: 'Inside the GPT-5 training run that cost $4.2B',      hoursAgo: 5, thumb: { hue: 0,   label: 'Compute spend leak' } },
      { ...S.ars,       headline: 'GPT-5 benchmarks: closer to AGI, still hallucinates', hoursAgo: 6, thumb: { hue: 30,  label: 'Benchmark sweep' } },
      { ...S.strat,     headline: 'GPT-5 and the end of the model-shopping era',         hoursAgo: 8, thumb: { hue: 280, label: 'Analysis · model commoditization' } },
      { ...S.plat,      headline: 'What GPT-5 means for Anthropic and Google',           hoursAgo: 9, thumb: { hue: 195, label: 'Competitive landscape' } },
    ],
  },
  {
    id: 'm5',
    topic: 'hardware',
    headline: 'Apple\'s M5 chip leaks point to a 3nm leap and on-die NPU',
    summary:
      'Benchmark dumps from a pre-release MacBook Pro show the M5 hitting 4,200 single-core in Geekbench, a 22% jump on M4. The big change is a dedicated 38-core NPU pushing 70 TOPS — enough to run Llama-3 70B locally at usable speeds. Mass production is reportedly underway at TSMC for an October launch.',
    hoursAgo: 5,
    readMin: 3,
    sources: [
      { ...S.semi,    headline: 'M5 die shot leak: 38-core NPU, 70 TOPS on-device',     hoursAgo: 5, thumb: { hue: 240, label: 'Die shot leak' } },
      { ...S.verge,   headline: 'Apple\'s M5 chips look like a generational leap',       hoursAgo: 7, thumb: { hue: 200, label: 'M5 vs M4 benchmarks' } },
      { ...S.bloomberg, headline: 'TSMC begins M5 mass production for fall MacBook',     hoursAgo: 10, thumb: { hue: 230, label: 'Fab timeline · TSMC N3P' } },
      { ...S.reg,     headline: 'On-device Llama-3 70B at 38 t/s — what the M5 unlocks', hoursAgo: 12, thumb: { hue: 0,   label: 'Local inference test' } },
      { ...S.ars,     headline: 'A closer look at the M5\'s memory bandwidth story',     hoursAgo: 14, thumb: { hue: 25,  label: 'LPDDR5X test' } },
    ],
  },
  {
    id: 'figma-ipo',
    topic: 'startups',
    headline: 'Figma files for IPO at a rumored $22B valuation',
    summary:
      'Figma\'s S-1 dropped overnight, revealing $1.3B ARR up 38% year-over-year and a 124% net dollar retention. The pricing range targets a $22B valuation — well above the $20B Adobe deal that fell through. Bankers are eyeing a June listing on the NYSE under ticker FIG.',
    hoursAgo: 7,
    readMin: 4,
    sources: [
      { ...S.info,    headline: 'Figma S-1: $1.3B ARR, 124% NDR, eyeing $22B IPO',   hoursAgo: 7, thumb: { hue: 320, label: 'S-1 highlights' } },
      { ...S.tc,      headline: 'Figma is finally going public. Here\'s the math.',  hoursAgo: 9, thumb: { hue: 140, label: 'ARR growth chart' } },
      { ...S.bench,   headline: 'Figma\'s IPO and the comeback of design-led SaaS',   hoursAgo: 12, thumb: { hue: 270, label: 'Sector analysis' } },
      { ...S.ft,      headline: 'Adobe\'s ghost still haunts the Figma roadshow',     hoursAgo: 16, thumb: { hue: 30,  label: 'M&A retrospective' } },
    ],
  },
  {
    id: 'npm-attack',
    topic: 'security',
    headline: 'Supply-chain attack hits npm: 4 popular packages compromised',
    summary:
      'Maintainers of node-ipc, colors, faker, and chalk-cli pushed malicious updates overnight after their npm tokens were phished. The payload exfiltrates environment variables to a Cloudflare Worker. GitHub yanked the versions within 90 minutes but estimated downloads in the window hit 1.4M. Rotate any keys touched on CI runs from the last 12 hours.',
    hoursAgo: 4,
    readMin: 5,
    breaking: true,
    sources: [
      { ...S.reg,     headline: 'Four popular npm packages backdoored in token phish',  hoursAgo: 4, thumb: { hue: 0,   label: 'Attack timeline' } },
      { ...S.ars,     headline: 'How the npm supply-chain attack actually worked',      hoursAgo: 5, thumb: { hue: 15,  label: 'Payload analysis' } },
      { ...S.tc,      headline: 'npm: 1.4M downloads served compromised packages',      hoursAgo: 6, thumb: { hue: 130, label: 'Blast radius' } },
      { ...S.verge,   headline: 'GitHub yanked the bad versions. The cleanup is huge.', hoursAgo: 7, thumb: { hue: 210, label: 'Mitigation guide' } },
    ],
  },
  {
    id: 'cursor',
    topic: 'dev',
    headline: 'Cursor 1.0 ships with multi-file agents and a self-hosted mode',
    summary:
      'Anysphere released Cursor 1.0 after two years in beta, headlined by a multi-file Composer agent that plans changes across a repo before applying them. A new self-hosted "Cursor Server" lets enterprises keep model traffic on-prem behind their own LLM gateway. Pricing stays flat at $20/mo.',
    hoursAgo: 11,
    readMin: 3,
    sources: [
      { ...S.tc,      headline: 'Cursor 1.0 lands with a Composer agent for big refactors', hoursAgo: 11, thumb: { hue: 250, label: 'Composer demo' } },
      { ...S.plat,    headline: 'Cursor at 1.0 and the slow death of the linear PR',        hoursAgo: 14, thumb: { hue: 190, label: 'Workflow shift' } },
      { ...S.reg,     headline: 'Self-hosted Cursor server: what enterprises actually get', hoursAgo: 18, thumb: { hue: 0,   label: 'Architecture diagram' } },
    ],
  },
  {
    id: 'meta-layoffs',
    topic: 'bigtech',
    headline: 'Meta cuts 3,600 in fourth efficiency round, mostly in Reality Labs',
    summary:
      'Meta confirmed a fourth wave of layoffs this morning, 3,600 employees or roughly 5% of headcount, with the bulk concentrated in Reality Labs and Threads. Zuckerberg\'s internal memo frames this as "the last big restructuring" before pivoting fully to a smaller AI-focused org. Severance follows the 16-week template from prior rounds.',
    hoursAgo: 1,
    readMin: 4,
    breaking: true,
    sources: [
      { ...S.bloomberg, headline: 'Meta cuts 3,600 jobs in latest efficiency push',       hoursAgo: 1, thumb: { hue: 230, label: 'Layoff tracker · Q2' } },
      { ...S.info,      headline: 'Inside Meta\'s "last restructuring" — who got hit',    hoursAgo: 2, thumb: { hue: 340, label: 'Org reshape' } },
      { ...S.verge,     headline: 'Reality Labs bore the brunt. Threads too.',            hoursAgo: 3, thumb: { hue: 210, label: 'Affected teams' } },
      { ...S.tc,        headline: 'Read Zuckerberg\'s memo to staff in full',              hoursAgo: 3, thumb: { hue: 150, label: 'Internal memo' } },
      { ...S.ft,        headline: 'Meta cuts and the great big-tech bodydown of 2026',    hoursAgo: 5, thumb: { hue: 25,  label: 'Industry context' } },
    ],
  },
  {
    id: 'eth-l2',
    topic: 'crypto',
    headline: 'Coinbase\'s Base hits $20B TVL, eclipsing Arbitrum',
    summary:
      'Base, Coinbase\'s Ethereum L2, crossed $20B in total value locked overnight, overtaking Arbitrum to become the largest L2 by TVL. Daily transactions are up 4x in a quarter, driven mostly by stablecoin payment apps. Coinbase still hasn\'t turned on the sequencer revenue share it promised, which is increasingly the elephant in the room.',
    hoursAgo: 8,
    readMin: 3,
    sources: [
      { ...S.decrypt, headline: 'Base flips Arbitrum to become the #1 Ethereum L2',    hoursAgo: 8, thumb: { hue: 270, label: 'TVL race · 2026' } },
      { ...S.bloomberg, headline: 'Base\'s $20B TVL milestone, by the numbers',         hoursAgo: 10, thumb: { hue: 230, label: 'Stablecoin flows' } },
      { ...S.plat,    headline: 'When does Coinbase actually share Base\'s revenue?',   hoursAgo: 14, thumb: { hue: 190, label: 'Tokenomics analysis' } },
    ],
  },
  {
    id: 'protein',
    topic: 'science',
    headline: 'DeepMind\'s AlphaProteo 2 designs a working malaria vaccine in days',
    summary:
      'A team at DeepMind and the Crick Institute used AlphaProteo 2 to design a novel malaria vaccine candidate that produced a protective immune response in mice within 14 days of compute. The Nature paper details a workflow that compresses years of wet-lab iteration into roughly a week. Phase 1 human trials are slated for late 2027.',
    hoursAgo: 16,
    readMin: 5,
    sources: [
      { ...S.nat,     headline: 'De-novo malaria vaccine design with AlphaProteo 2', hoursAgo: 16, thumb: { hue: 130, label: 'Nature paper · figure 3' } },
      { ...S.wired,   headline: 'How DeepMind\'s new model designs vaccines in days', hoursAgo: 20, thumb: { hue: 240, label: 'Workflow explainer' } },
      { ...S.ars,     headline: 'AlphaProteo 2 and the next era of computational bio', hoursAgo: 24, thumb: { hue: 25,  label: 'Field analysis' } },
    ],
  },
];
