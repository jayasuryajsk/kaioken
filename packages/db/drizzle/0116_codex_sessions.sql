ALTER TABLE `threads` ADD `source_provider_thread_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `handoff_state` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `source_synced_ordinal` integer;--> statement-breakpoint
CREATE INDEX `threads_source_provider_thread_idx` ON `threads` (`source_provider_thread_id`);