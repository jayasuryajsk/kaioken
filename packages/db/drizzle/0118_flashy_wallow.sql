CREATE TABLE `connection_handoffs` (
	`id` text NOT NULL,
	`role` text NOT NULL,
	`phase` text NOT NULL,
	`source_thread_id` text,
	`target_thread_id` text,
	`payload` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`id`, `role`)
);
--> statement-breakpoint
CREATE INDEX `connection_handoffs_source_idx` ON `connection_handoffs` (`source_thread_id`,`role`,`phase`);