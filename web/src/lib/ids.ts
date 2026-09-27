const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB에 uuid로 넘기기 전에 형식을 확인한다. 형식이 틀린 값이 쿼리에서 500으로 터지지 않게 한다. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
