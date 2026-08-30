CREATE TABLE profiles (
  home_id uuid NOT NULL REFERENCES homes(id),
  id uuid NOT NULL,
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  sort_order integer NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (home_id, id)
);
CREATE INDEX profiles_active_order_idx ON profiles(home_id, sort_order) WHERE deleted_at IS NULL;

ALTER TABLE change_log DROP CONSTRAINT change_log_entity_type_check;
ALTER TABLE change_log ADD CONSTRAINT change_log_entity_type_check
  CHECK (entity_type IN ('home', 'profile', 'room', 'task', 'completion'));

ALTER TABLE completion_records ADD COLUMN profile_id uuid;
ALTER TABLE completion_records
  ADD CONSTRAINT completion_records_profile_fk
  FOREIGN KEY (home_id, profile_id) REFERENCES profiles(home_id, id);
CREATE INDEX completions_active_profile_idx ON completion_records(home_id, profile_id, completed_at)
  WHERE deleted_at IS NULL AND profile_id IS NOT NULL;
