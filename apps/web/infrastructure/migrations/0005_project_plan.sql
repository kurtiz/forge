CREATE TABLE `project_journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`entry_path` text DEFAULT '/' NOT NULL,
	`priority` real DEFAULT 0.5 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_journeys_project_idx` ON `project_journeys` (`project_id`,`priority`);--> statement-breakpoint
CREATE TABLE `project_sample_values` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_sample_values_project_idx` ON `project_sample_values` (`project_id`,`created_at`);