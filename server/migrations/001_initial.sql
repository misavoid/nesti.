CREATE SEQUENCE sync_cursor_sequence AS bigint;

CREATE TABLE homes (
  id uuid PRIMARY KEY,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX devices_home_id_idx ON devices(home_id);

CREATE TABLE pairing_codes (
  id uuid PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  code_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
CREATE INDEX pairing_codes_home_id_idx ON pairing_codes(home_id);
CREATE INDEX pairing_codes_expires_at_idx ON pairing_codes(expires_at) WHERE used_at IS NULL;

CREATE TABLE rooms (
  home_id uuid NOT NULL REFERENCES homes(id),
  id uuid NOT NULL,
  name varchar(200) NOT NULL,
  notes text NOT NULL DEFAULT '',
  icon varchar(200) NOT NULL,
  sort_order integer NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (home_id, id)
);
CREATE INDEX rooms_active_order_idx ON rooms(home_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE tasks (
  home_id uuid NOT NULL REFERENCES homes(id),
  id uuid NOT NULL,
  room_id uuid NOT NULL,
  name varchar(200) NOT NULL,
  notes text NOT NULL DEFAULT '',
  estimated_minutes integer CHECK (estimated_minutes BETWEEN 1 AND 1440),
  sort_order integer NOT NULL,
  schedule jsonb,
  last_completed_at timestamptz,
  next_due_date text,
  reminder jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (home_id, id),
  FOREIGN KEY (home_id, room_id) REFERENCES rooms(home_id, id)
);
CREATE INDEX tasks_active_room_idx ON tasks(home_id, room_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE completion_records (
  home_id uuid NOT NULL REFERENCES homes(id),
  id uuid NOT NULL,
  task_id uuid NOT NULL,
  completed_at timestamptz NOT NULL,
  scheduled_for text,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (home_id, id),
  FOREIGN KEY (home_id, task_id) REFERENCES tasks(home_id, id)
);
CREATE INDEX completions_active_task_idx ON completion_records(home_id, task_id, completed_at) WHERE deleted_at IS NULL;

CREATE TABLE change_log (
  cursor bigint PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  entity_type varchar(20) NOT NULL CHECK (entity_type IN ('home', 'room', 'task', 'completion')),
  entity_id uuid NOT NULL,
  operation varchar(10) NOT NULL CHECK (operation IN ('upsert', 'delete')),
  revision bigint NOT NULL CHECK (revision = cursor),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((operation = 'delete' AND payload IS NULL) OR (operation = 'upsert' AND payload IS NOT NULL))
);
CREATE INDEX change_log_home_cursor_idx ON change_log(home_id, cursor);

CREATE TABLE applied_mutations (
  home_id uuid NOT NULL REFERENCES homes(id),
  mutation_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices(id),
  result jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (home_id, mutation_id)
);
CREATE INDEX applied_mutations_retention_idx ON applied_mutations(applied_at);
