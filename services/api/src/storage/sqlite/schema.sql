create table producers (
  id text primary key,
  app text not null,
  version text not null,
  instance_id text not null,
  display_name text,
  created_at text not null
);

create table games (
  game_key text primary key,
  game_family text not null,
  title text not null,
  default_mode text,
  created_at text not null
);

create table sessions (
  id text primary key,
  producer_id text not null references producers(id),
  source_session_id text not null,
  game_key text not null references games(game_key),
  mode text not null,
  source text not null,
  started_at text,
  ended_at text,
  status text not null default 'active',
  metadata_json text not null default '{}',
  created_at text not null,
  updated_at text not null,
  unique (producer_id, source_session_id)
);

create table ingest_batches (
  id text primary key,
  producer_id text not null references producers(id),
  idempotency_key text not null unique,
  received_at text not null,
  accepted_count integer not null default 0,
  duplicate_count integer not null default 0,
  rejected_count integer not null default 0,
  errors_json text not null default '[]'
);

create table events (
  id text primary key,
  producer_id text not null references producers(id),
  session_id text not null references sessions(id),
  source_event_id text not null,
  game_key text not null references games(game_key),
  event_type text not null,
  occurred_at text not null,
  received_at text not null,
  seq integer,
  actor_json text,
  object_json text,
  targets_json text,
  payload_json text not null,
  confidence real,
  review_status text not null default 'none',
  provenance_json text not null default '{}',
  unique (producer_id, session_id, source_event_id)
);

create index idx_events_session_seq on events(session_id, seq);
create index idx_events_type_time on events(event_type, occurred_at);
create index idx_sessions_game_time on sessions(game_key, started_at);
