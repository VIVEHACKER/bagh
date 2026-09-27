/** 브라우저에서 우리 API를 부르는 얇은 도우미. 실패하면 서버의 { error: { code, message } }를 그대로 던진다. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    throw new ApiError(data.error?.code ?? "internal", data.error?.message ?? "잠시 뒤에 다시 시도해 주세요.", res.status);
  }
  return data as T;
}

export function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "잠시 뒤에 다시 시도해 주세요.";
}
