DROP INDEX `tracked_ref_widget_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_ref_widget_plugin_key` ON `tracked_ref` (`widget_path`,`plugin_id`,`ref_key`);