// Choose which collected items go to the curator.
//
// Sources listed in config.alwaysCurate (reader submissions, and sources we pay for
// per post such as X) always reach the curator: they skip the keyword filter and do
// not count against maxCandidates. Everything else needs at least one keyword match
// and is ranked by keyword relevance and engagement relative to its own source's best
// item, then capped at maxCandidates. Engagement only orders the free pool; the
// curator, not popularity, decides what is worth publishing.
export function selectCandidates(items, config) {
  const always = new Set(config.alwaysCurate ?? ["submission"]);
  const keywords = config.keywords.map((k) => k.toLowerCase());
  const maxBySource = {};
  for (const c of items) maxBySource[c.source] = Math.max(maxBySource[c.source] || 1, c.engagement.score);

  const scored = items.map((c) => {
    const hay = `${c.title} ${c.text}`.toLowerCase();
    const relevance = keywords.filter((k) => hay.includes(k)).length;
    const engagement = Math.log10(c.engagement.score + 1) / Math.log10(maxBySource[c.source] + 1);
    const rank = always.has(c.source) ? 2 : 0.5 * engagement + 0.5 * (Math.min(relevance, 4) / 4);
    return { ...c, relevance, rank: Number(rank.toFixed(3)) };
  });

  const guaranteed = scored.filter((c) => always.has(c.source));
  const pool = scored
    .filter((c) => !always.has(c.source) && c.relevance > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, config.maxCandidates);
  return [...guaranteed, ...pool];
}
