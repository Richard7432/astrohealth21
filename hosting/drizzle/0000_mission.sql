CREATE TABLE visitor_mission (
  visitor TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX visitor_mission_expiration ON visitor_mission (expires);
--> statement-breakpoint
CREATE TABLE environment_cache (
  selection TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  fetched INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX environment_cache_age ON environment_cache (fetched);
--> statement-breakpoint
CREATE TABLE external_quota (
  operation TEXT PRIMARY KEY,
  available_at INTEGER NOT NULL
);
