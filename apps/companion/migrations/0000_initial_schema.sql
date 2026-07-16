CREATE TABLE `sessions` (
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_time` ON `sessions` (`user_id`,"started_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_dedupe` ON `sessions` (`user_id`,`device_serial`,`started_at`);--> statement-breakpoint
CREATE TABLE `station_intervals` (
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
	FOREIGN KEY (`station_id`) REFERENCES `stations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_intervals_user_station` ON `station_intervals` (`user_id`,`station_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `intervals_session_lap` ON `station_intervals` (`session_id`,`lap_index`);--> statement-breakpoint
CREATE TABLE `stations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`thermal_class` text DEFAULT 'unclassified' NOT NULL,
	`is_transition` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "thermal_class_valid" CHECK("stations"."thermal_class" IN ('hot', 'cold', 'neutral', 'unclassified'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stations_name_unique` ON `stations` (`name`);