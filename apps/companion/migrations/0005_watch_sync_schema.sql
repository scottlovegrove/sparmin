CREATE TABLE `device_link_codes` (
	`user_code` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`install_id` text NOT NULL,
	`product` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_polled_at` integer,
	`approved_at` integer,
	`consumed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_link_codes_device_code_hash_unique` ON `device_link_codes` (`device_code_hash`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`install_id` text NOT NULL,
	`product` text,
	`name` text,
	`token_hash` text NOT NULL,
	`serial` text,
	`linked_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_user_install` ON `devices` (`user_id`,`install_id`);--> statement-breakpoint
--> Hand-fixed: this PRAGMA does nothing here, and relying on it cost real data.
--> `PRAGMA foreign_keys` is a documented no-op inside a transaction, and D1 runs
--> each migration file in one — so foreign keys stay enforced no matter what this
--> line says. `station_intervals` cascades on `sessions`, so the DROP below fires
--> ON DELETE CASCADE and deletes every stay in the database while the sessions
--> themselves survive, having already been copied out. `PRAGMA defer_foreign_keys`
--> is not a fix either: it defers violation *checking*, not the cascade action.
--> The children are therefore carried across by hand, below and after the rename.
--> Anything that rebuilds a table with dependants must do the same.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__carry_station_intervals` AS SELECT * FROM `station_intervals`;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`utc_offset_s` integer,
	`device_serial` text,
	`device_product` text,
	`total_elapsed_s` real NOT NULL,
	`total_timer_s` real,
	`total_calories` integer,
	`avg_hr` integer,
	`max_hr` integer,
	`source` text DEFAULT 'fit' NOT NULL,
	`watch_session_id` text,
	`device_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "session_source_valid" CHECK("__new_sessions"."source" IN ('fit', 'watch', 'both'))
);
--> statement-breakpoint
--> Hand-fixed: drizzle-kit builds one column list from the NEW table and uses it
--> on both sides, so it emitted "source", "watch_session_id" and "device_id" in
--> the SELECT as well — columns the old `sessions` does not have, which fails
--> with `no such column: source`. Dropped from both lists: `source` takes its
--> DEFAULT 'fit', which is right for every row that predates the watch, and the
--> other two are nullable. (0002's rebuild escaped this by adding no columns.)
INSERT INTO `__new_sessions`("id", "user_id", "started_at", "ended_at", "utc_offset_s", "device_serial", "device_product", "total_elapsed_s", "total_timer_s", "total_calories", "avg_hr", "max_hr", "created_at") SELECT "id", "user_id", "started_at", "ended_at", "utc_offset_s", "device_serial", "device_product", "total_elapsed_s", "total_timer_s", "total_calories", "avg_hr", "max_hr", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
--> Hand-added: put the stays back. The DROP above took them with it, because the
--> cascade fires whatever the PRAGMA claims. Their parent rows are unchanged, so
--> every foreign key still resolves.
INSERT INTO `station_intervals` SELECT * FROM `__carry_station_intervals`;--> statement-breakpoint
DROP TABLE `__carry_station_intervals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_watch_uuid` ON `sessions` (`watch_session_id`) WHERE "sessions"."watch_session_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sessions_fit_dedupe` ON `sessions` (`user_id`,`device_serial`,`started_at`) WHERE "sessions"."device_serial" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_sessions_user_started` ON `sessions` (`user_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `station_intervals` ADD `min_hr` integer;--> statement-breakpoint
ALTER TABLE `stations` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `stations_slug_unique` ON `stations` (`slug`);--> statement-breakpoint
--> Hand-added: seed the watch's canonical station ids, the way 0001 and 0004
--> seed the names. The pairs are apps/watch/source/SpaActivity.mc's IDS and
--> NAMES, which are index-aligned; the names must keep matching 0001/0004
--> exactly, since they are what the FIT writes into each lap.
--> `transition` deliberately keeps a NULL slug: it is SessionManager's lap label,
--> not a catalogue entry, and the watch's payload never refers to it.
UPDATE stations SET slug = 'outdoor_cold_plunge' WHERE name = 'Outdoor cold plunge';--> statement-breakpoint
UPDATE stations SET slug = 'indoor_cold_plunge'  WHERE name = 'Indoor cold plunge';--> statement-breakpoint
UPDATE stations SET slug = 'hydro_pool'          WHERE name = 'Hydro pool';--> statement-breakpoint
UPDATE stations SET slug = 'heated_loungers'     WHERE name = 'Heated loungers';--> statement-breakpoint
UPDATE stations SET slug = 'salt_sauna'          WHERE name = 'Himalayan salt sauna';--> statement-breakpoint
UPDATE stations SET slug = 'steam_room'          WHERE name = 'Steam room';--> statement-breakpoint
UPDATE stations SET slug = 'fire_ice_room'       WHERE name = 'Fire and ice room';--> statement-breakpoint
UPDATE stations SET slug = 'finnish_sauna'       WHERE name = 'Finnish sauna';--> statement-breakpoint
UPDATE stations SET slug = 'ice_cave'            WHERE name = 'Ice cave';--> statement-breakpoint
UPDATE stations SET slug = 'outdoor_lounger'     WHERE name = 'Outdoor lounger';--> statement-breakpoint
UPDATE stations SET slug = 'hot_tub'             WHERE name = 'Hot tub';