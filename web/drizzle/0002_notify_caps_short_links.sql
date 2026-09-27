CREATE TABLE "short_links" (
	"code" text PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "notify_skip" text;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "short_links_thread_idx" ON "short_links" USING btree ("thread_id");--> statement-breakpoint
-- 이미 알림이 나간 기존 습득자 메시지는 알림 시각을 채운다(습득자 화면이 "저장만 됨"으로 보이지 않게, 한도 계산에도 넣는다).
UPDATE "messages" SET "notified_at" = "created_at" WHERE "sender" = 'finder' AND EXISTS (SELECT 1 FROM "notifications" n WHERE n."message_id" = "messages"."id");
