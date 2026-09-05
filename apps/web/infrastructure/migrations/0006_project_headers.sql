CREATE TABLE `project_headers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`value_encrypted` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_headers_project_idx` ON `project_headers` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_headers_name_idx` ON `project_headers` (`project_id`,`name`);