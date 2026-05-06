CREATE TABLE IF NOT EXISTS raw_chunks (
  session_id TEXT NOT NULL,
  chunk_offset INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  UNIQUE(session_id, chunk_offset, sha256)
);

CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(session_id, sequence, timestamp, event_type, payload_json)
);
