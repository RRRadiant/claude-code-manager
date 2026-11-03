/**
 * Structured errors for the install pipeline.
 *
 * Ported from `error.rs` in the Windows build: a stable code, user-facing title
 * and message, optional technical details, and actionable suggestions. The
 * suggestions list is what turns "安装失败" into something a user can act on.
 */

import type { AppErrorShape } from './types'

export const codes = {
  NETWORK: 'INSTALL_NETWORK_ERROR',
  DOWNLOAD_FAILED: 'INSTALL_DOWNLOAD_FAILED',
  VERIFY_FAILED: 'INSTALL_VERIFY_FAILED',
  EXTRACT_FAILED: 'INSTALL_EXTRACT_FAILED',
  ENV_INCOMPLETE: 'INSTALL_ENV_INCOMPLETE',
  CANCELLED: 'INSTALL_CANCELLED',
  FAILED: 'INSTALL_FAILED',
} as const

export type ErrorCode = (typeof codes)[keyof typeof codes]

export class AppError extends Error {
  readonly code: string
  readonly title: string
  readonly details?: string
  readonly suggestions: string[]
  readonly retryable: boolean

  constructor(shape: AppErrorShape) {
    super(shape.message)
    this.name = 'AppError'
    this.code = shape.code
    this.title = shape.title
    this.details = shape.details
    this.suggestions = shape.suggestions ?? []
    this.retryable = shape.retryable ?? false
  }

  withDetails(details: string): AppError {
    return new AppError({
      code: this.code,
      title: this.title,
      message: this.message,
      details,
      suggestions: this.suggestions,
      retryable: this.retryable,
    })
  }

  withSuggestions(...suggestions: string[]): AppError {
    return new AppError({
      code: this.code,
      title: this.title,
      message: this.message,
      details: this.details,
      suggestions,
      retryable: this.retryable,
    })
  }

  retryableError(): AppError {
    return new AppError({
      code: this.code,
      title: this.title,
      message: this.message,
      details: this.details,
      suggestions: this.suggestions,
      retryable: true,
    })
  }

  /** Flat text for a log line or a step message. */
  toText(): string {
    return this.details ? `${this.message} (${this.details})` : this.message
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      title: this.title,
      message: this.message,
      details: this.details,
      suggestions: this.suggestions,
      retryable: this.retryable,
    }
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

/** Coerce anything thrown into an AppError so callers never see a bare string. */
export function toAppError(e: unknown, fallbackCode: string = codes.FAILED): AppError {
  if (isAppError(e)) return e
  const message = e instanceof Error ? e.message : String(e)
  return new AppError({
    code: fallbackCode,
    title: '操作失败',
    message,
  })
}

export const cancelledError = (): AppError =>
  new AppError({
    code: codes.CANCELLED,
    title: '操作已取消',
    message: '用户取消了操作。',
  })
