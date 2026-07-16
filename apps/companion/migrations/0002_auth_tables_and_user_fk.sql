CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
--> Hand-added: sessions written before there was a user table are owned by a
--> placeholder id that references nothing, and the foreign key added below would
--> leave them orphaned (SQLite only enforces a key on write, so they would sit
--> there unnoticed). `user` is new and empty at this point, so this clears every
--> row that has no real owner. Runs while foreign keys are still on, so the
--> intervals go with them.
DELETE FROM `sessions` WHERE `user_id` NOT IN (SELECT `id` FROM `user`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`utc_offset_s` integer,
	`device_serial` text NOT NULL,
	`device_product` text,
	`total_elapsed_s` real NOT NULL,
	`total_timer_s` real,
	`total_calories` integer,
	`avg_hr` integer,
	`max_hr` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "user_id", "started_at", "ended_at", "utc_offset_s", "device_serial", "device_product", "total_elapsed_s", "total_timer_s", "total_calories", "avg_hr", "max_hr", "created_at") SELECT "id", "user_id", "started_at", "ended_at", "utc_offset_s", "device_serial", "device_product", "total_elapsed_s", "total_timer_s", "total_calories", "avg_hr", "max_hr", "created_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
--> Hand-fixed: drizzle-kit's table-rebuild path quotes the whole `"started_at"
--> desc` expression as if it were a column name, which fails with `no such column`.
--> This is what it emits itself in 0000, where no rebuild is involved.
CREATE INDEX `idx_sessions_user_time` ON `sessions` (`user_id`,"started_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_dedupe` ON `sessions` (`user_id`,`device_serial`,`started_at`);--> statement-breakpoint
CREATE TABLE `__new_station_intervals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`station_id` integer NOT NULL,
	`lap_index` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`elapsed_s` real NOT NULL,
	`timer_s` real,
	`avg_hr` integer,
	`max_hr` integer,
	`calories` integer,
	`cycles` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_station_intervals`("id", "session_id", "user_id", "station_id", "lap_index", "started_at", "ended_at", "elapsed_s", "timer_s", "avg_hr", "max_hr", "calories", "cycles") SELECT "id", "session_id", "user_id", "station_id", "lap_index", "started_at", "ended_at", "elapsed_s", "timer_s", "avg_hr", "max_hr", "calories", "cycles" FROM `station_intervals`;--> statement-breakpoint
DROP TABLE `station_intervals`;--> statement-breakpoint
ALTER TABLE `__new_station_intervals` RENAME TO `station_intervals`;--> statement-breakpoint
CREATE INDEX `idx_intervals_user_station` ON `station_intervals` (`user_id`,`station_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `intervals_session_lap` ON `station_intervals` (`session_id`,`lap_index`);