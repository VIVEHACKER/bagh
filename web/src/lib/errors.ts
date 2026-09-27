/** 도메인 오류. code는 클라이언트가 분기에 쓰는 안정된 문자열이다. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(code, message, 400, details);
export const unauthorized = (message = "로그인이 필요해요.") => new AppError("unauthorized", message, 401);
export const forbidden = (code: string, message: string) => new AppError(code, message, 403);
export const notFound = (code: string, message: string) => new AppError(code, message, 404);
export const conflict = (code: string, message: string) => new AppError(code, message, 409);
export const gone = (code: string, message: string) => new AppError(code, message, 410);
export const unavailable = (code: string, message: string) => new AppError(code, message, 503);
export const rateLimited = (retryAfterSec: number) =>
  new AppError("rate_limited", "잠시 뒤에 다시 시도해 주세요.", 429, { retryAfterSec });

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
