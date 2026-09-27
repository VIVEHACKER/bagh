import { and, asc, eq, isNull } from "drizzle-orm";
import { stickerSets, stickers } from "@/db/schema";
import { CLAIM_CODE_LENGTH, isValidCode, normalizeCode } from "@/lib/codes";
import { lookupHash } from "@/lib/crypto";
import { badRequest, conflict, rateLimited } from "@/lib/errors";
import type { Deps } from "../deps";

export interface ClaimedSticker {
  token: string;
  position: number;
  label: string | null;
  status: string;
}

const HOUR = 3_600_000;

/**
 * 등록 코드로 세트를 주인 계정에 묶고 스티커를 켠다.
 * 설계 제약: 주인 등록은 사이트에서 코드로만 한다. 스캔으로 주인·습득자를 가르지 않는다(docs/02 §3).
 */
export async function claimSet(deps: Deps, input: { ownerId: string; claimCode: string; ip: string }): Promise<ClaimedSticker[]> {
  const r = await deps.limiter.hitAll(
    [
      { key: `claim:owner:${input.ownerId}`, limit: 10, windowMs: HOUR },
      { key: `claim:ip:${input.ip}`, limit: 20, windowMs: HOUR },
    ],
    deps.now().getTime(),
  );
  if (!r.ok) throw rateLimited(r.retryAfterSec);

  const code = normalizeCode(input.claimCode);
  if (!isValidCode(code, CLAIM_CODE_LENGTH)) throw badRequest("claim_code_invalid", "등록 코드 8자리를 확인해 주세요.");

  const [set] = await deps.db
    .select()
    .from(stickerSets)
    .where(eq(stickerSets.claimCodeHash, lookupHash(code, deps.keys.lookup)))
    .limit(1);
  if (!set) throw badRequest("claim_code_invalid", "등록 코드 8자리를 확인해 주세요.");
  if (set.ownerId && set.ownerId !== input.ownerId) throw conflict("claim_code_used", "이미 다른 계정에 등록된 코드예요.");

  if (!set.ownerId) {
    await deps.db.transaction(async (tx) => {
      const updated = await tx
        .update(stickerSets)
        .set({ ownerId: input.ownerId, claimedAt: deps.now() })
        .where(and(eq(stickerSets.id, set.id), isNull(stickerSets.ownerId)))
        .returning({ id: stickerSets.id });
      if (updated.length === 0) throw conflict("claim_code_used", "이미 다른 계정에 등록된 코드예요.");
      await tx.update(stickers).set({ status: "active" }).where(and(eq(stickers.setId, set.id), eq(stickers.status, "unclaimed")));
    });
  }

  return deps.db
    .select({ token: stickers.token, position: stickers.position, label: stickers.label, status: stickers.status })
    .from(stickers)
    .where(eq(stickers.setId, set.id))
    .orderBy(asc(stickers.position));
}
