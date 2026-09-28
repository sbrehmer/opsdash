CREATE TABLE `plugin_state` (
	`plugin_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `ref_link` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_ref_id` integer NOT NULL,
	`to_ref_id` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_ref_id`) REFERENCES `tracked_ref`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_ref_id`) REFERENCES `tracked_ref`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ref_link_not_self" CHECK("ref_link"."from_ref_id" != "ref_link"."to_ref_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ref_link_pair` ON `ref_link` (`from_ref_id`,`to_ref_id`);--> statement-breakpoint
CREATE TABLE `tracked_ref` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`widget_path` text NOT NULL,
	`plugin_id` text NOT NULL,
	`ref_key` text NOT NULL,
	`ref` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tracked_ref_widget` ON `tracked_ref` (`widget_path`);--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_ref_widget_key` ON `tracked_ref` (`widget_path`,`ref_key`);