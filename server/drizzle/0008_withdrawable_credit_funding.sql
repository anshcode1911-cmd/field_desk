PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_credit_funds` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_note_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`transfer_id` text,
	FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credit_funds_amount_paise_check" CHECK(typeof("__new_credit_funds"."amount_paise") = 'integer' and (("__new_credit_funds"."amount_paise" > 0 and "__new_credit_funds"."transfer_id" is null) or ("__new_credit_funds"."amount_paise" < 0 and "__new_credit_funds"."transfer_id" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_credit_funds`("id", "credit_note_id", "receipt_id", "amount_paise", "transfer_id") SELECT "id", "credit_note_id", "receipt_id", "amount_paise", NULL FROM `credit_funds`;--> statement-breakpoint
DROP TABLE `credit_funds`;--> statement-breakpoint
ALTER TABLE `__new_credit_funds` RENAME TO `credit_funds`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `credit_funds_credit_note_id_idx` ON `credit_funds` (`credit_note_id`);--> statement-breakpoint
CREATE INDEX `credit_funds_receipt_id_idx` ON `credit_funds` (`receipt_id`);