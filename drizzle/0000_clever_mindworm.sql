CREATE TABLE `tool_usage` (
	`tool_id` text PRIMARY KEY NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usage_stats` (
	`id` integer PRIMARY KEY NOT NULL,
	`jobs` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
