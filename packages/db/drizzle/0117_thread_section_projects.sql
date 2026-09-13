CREATE TABLE `thread_section_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_id`) REFERENCES `thread_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_section_projects_section_idx` ON `thread_section_projects` (`section_id`);