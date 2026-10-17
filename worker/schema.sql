-- Votes for delegatedto.ai. Only counts are kept long-term.
CREATE TABLE IF NOT EXISTS votes (case_id TEXT PRIMARY KEY, total INTEGER NOT NULL DEFAULT 0);
-- Per-day counts, for "Trending today". Rows older than a few days are deleted.
CREATE TABLE IF NOT EXISTS daily (case_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (case_id, day));
-- Short-lived abuse guards. `k` is a salted SHA-256 hash; no IP address is stored.
CREATE TABLE IF NOT EXISTS seen (k TEXT PRIMARY KEY, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL);
-- Small cached values (the newsletter subscriber count), with an expiry.
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL);
-- Reader submissions: a link and an optional note (nothing about the sender), kept 30 days.
CREATE TABLE IF NOT EXISTS submissions (url TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', created INTEGER NOT NULL);
