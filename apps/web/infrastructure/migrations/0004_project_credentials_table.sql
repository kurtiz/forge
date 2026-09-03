CREATE TABLE `project_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text NOT NULL,
	`login_path` text NOT NULL,
	`username` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`profile_id` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_credentials_project_idx` ON `project_credentials` (`project_id`,`created_at`);--> statement-breakpoint
-- Carry every login already stored on a project into the new table, as that
-- project's default account. Written by hand because the column drops below
-- would otherwise take the data with them.
INSERT INTO `project_credentials` (
	`id`, `project_id`, `label`, `login_path`, `username`,
	`password_encrypted`, `profile_id`, `is_default`, `created_at`, `updated_at`
)
SELECT
	'pcr_' || lower(hex(randomblob(6))),
	`id`,
	'Test account',
	COALESCE(`auth_login_path`, '/login'),
	`auth_username`,
	`auth_password_encrypted`,
	`auth_profile_id`,
	1,
	`created_at`,
	`updated_at`
FROM `projects`
WHERE `auth_username` IS NOT NULL AND `auth_password_encrypted` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `auth_login_path`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `auth_username`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `auth_password_encrypted`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `auth_profile_id`;