CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`userId`);--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`finding_id` text,
	`journey_id` text,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`storage_key` text,
	`content_type` text,
	`size_bytes` integer,
	`metadata` text DEFAULT '{}' NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `evidence_run_idx` ON `evidence` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `evidence_finding_idx` ON `evidence` (`finding_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`journey_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`failure_class` text NOT NULL,
	`classification` text NOT NULL,
	`severity` text NOT NULL,
	`confidence` real NOT NULL,
	`reproduction_attempts` integer DEFAULT 0 NOT NULL,
	`reproduction_failures` integer DEFAULT 0 NOT NULL,
	`root_cause` text,
	`root_cause_confidence` real,
	`affected_files` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `findings_run_idx` ON `findings` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fix_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`verification_run_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`verification_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fix_attempts_finding_idx` ON `fix_attempts` (`finding_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `journey_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`expected` text,
	`actual` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journey_steps_journey_idx` ON `journey_steps` (`journey_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`entry_path` text DEFAULT '/' NOT NULL,
	`priority` real DEFAULT 0.5 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confidence` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journeys_run_idx` ON `journeys` (`run_id`,`priority`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`target_url` text NOT NULL,
	`repo_url` text,
	`goal` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_seq_idx` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`executor` text NOT NULL,
	`target_url` text NOT NULL,
	`repo_url` text,
	`session_id` text,
	`replay_url` text,
	`verifies_finding_id` text,
	`idempotency_key` text,
	`summary` text,
	`error` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_project_idx` ON `runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_idempotency_idx` ON `runs` (`project_id`,`idempotency_key`) WHERE "runs"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`userId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`isAnonymous` integer DEFAULT false,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);