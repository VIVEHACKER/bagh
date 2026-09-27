ALTER TABLE "notifications" DROP CONSTRAINT "notifications_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_login_phone_uq" ON "contacts" USING btree ("phone_hmac") WHERE "contacts"."is_login" = true;