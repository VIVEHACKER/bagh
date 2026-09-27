import { batches, stickerSets, stickers } from "@/db/schema";
import { CLAIM_CODE_LENGTH, TOKEN_LENGTH, randomCode } from "@/lib/codes";
import { lookupHash } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import type { Deps } from "../deps";

export interface IssueBatchInput {
  sku: string;
  setCount: number;
  stickersPerSet: number;
}

export interface IssuedSet {
  setId: string;
  /** 평문은 발급할 때 한 번만 돌려준다. DB에는 해시만 남는다. */
  claimCode: string;
  tokens: string[];
}

export interface IssuedBatch {
  batchId: string;
  sets: IssuedSet[];
}

const MAX_SETS = 5000;
const MAX_STICKERS_PER_SET = 24;

/** 인쇄용 세트(등록 코드 1개 + 스티커 토큰 N개)를 발급한다. 충돌은 유니크 제약으로 걸러 다시 뽑는다. */
export async function issueBatch(deps: Deps, input: IssueBatchInput): Promise<IssuedBatch> {
  const sku = input.sku.trim();
  if (!/^[a-z0-9-]{2,32}$/.test(sku)) throw badRequest("sku_invalid", "sku는 영소문자·숫자·하이픈 2~32자여야 해요.");
  if (!Number.isInteger(input.setCount) || input.setCount < 1 || input.setCount > MAX_SETS)
    throw badRequest("set_count_invalid", `세트 수는 1~${MAX_SETS}이어야 해요.`);
  if (!Number.isInteger(input.stickersPerSet) || input.stickersPerSet < 1 || input.stickersPerSet > MAX_STICKERS_PER_SET)
    throw badRequest("stickers_per_set_invalid", `세트당 스티커 수는 1~${MAX_STICKERS_PER_SET}이어야 해요.`);

  return deps.db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(batches)
      .values({ sku, setCount: input.setCount, stickersPerSet: input.stickersPerSet })
      .returning({ id: batches.id });

    const sets: IssuedSet[] = [];
    for (let i = 0; i < input.setCount; i += 1) {
      let claimCode = "";
      let setId = "";
      for (let attempt = 0; !setId; attempt += 1) {
        if (attempt >= 5) throw new Error("claim code collision retry exhausted");
        claimCode = randomCode(CLAIM_CODE_LENGTH);
        const inserted = await tx
          .insert(stickerSets)
          .values({ batchId: batch.id, claimCodeHash: lookupHash(claimCode, deps.keys.lookup) })
          .onConflictDoNothing()
          .returning({ id: stickerSets.id });
        setId = inserted[0]?.id ?? "";
      }

      const tokens: string[] = [];
      for (let position = 0; position < input.stickersPerSet; position += 1) {
        let token = "";
        for (let attempt = 0; !token; attempt += 1) {
          if (attempt >= 5) throw new Error("token collision retry exhausted");
          const candidate = randomCode(TOKEN_LENGTH);
          const inserted = await tx
            .insert(stickers)
            .values({ token: candidate, setId, position })
            .onConflictDoNothing()
            .returning({ token: stickers.token });
          token = inserted[0]?.token ?? "";
        }
        tokens.push(token);
      }
      sets.push({ setId, claimCode, tokens });
    }
    return { batchId: batch.id, sets };
  });
}
