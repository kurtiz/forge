ALTER TABLE `projects` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `projects_deleted_idx` ON `projects` (`deleted_at`);