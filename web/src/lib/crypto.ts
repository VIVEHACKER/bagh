import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type KeyPurpose = "phone-enc" | "lookup-hmac" | "link-sign" | "secret-hash";

/** APP_SECRET 하나에서 용도별 키를 파생한다. 용도가 다르면 키도 다르다. */
export function deriveKey(appSecret: string, purpose: KeyPurpose): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret, "baghome/v1", purpose, 32));
}

const ENC_VERSION = "v1";

/** AES-256-GCM. 결과 형식: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== ENC_VERSION || !iv || !tag || !ct) throw new Error("encrypted payload has unknown format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** 조회용 결정적 해시(전화번호·등록 코드). 같은 입력이면 같은 값이다. */
export function lookupHash(value: string, key: Buffer): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

/** 세션·습득자 키처럼 무작위 비밀값을 저장할 때 쓰는 해시. */
export function secretHash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function linkSignature(subject: string, expiresAtSec: number, key: Buffer): string {
  return createHmac("sha256", key).update(`${subject}.${expiresAtSec}`).digest("base64url");
}

export function signLink(subject: string, expiresAtSec: number, key: Buffer): string {
  return linkSignature(subject, expiresAtSec, key);
}

export type LinkCheck = "valid" | "expired" | "invalid";

export function verifyLink(subject: string, expiresAtSec: number, signature: string, key: Buffer, nowSec: number): LinkCheck {
  const expected = Buffer.from(linkSignature(subject, expiresAtSec, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  return nowSec > expiresAtSec ? "expired" : "valid";
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
