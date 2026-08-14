CREATE TABLE `device_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`app_version` text,
	`line` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_logs_dedupe` ON `device_logs` (`device_id`,`recorded_at`,`line`);--> statement-breakpoint
CREATE INDEX `idx_device_logs_user_recorded` ON `device_logs` (`user_id`,`recorded_at`);