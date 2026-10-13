export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function notFound(): never { throw new ApiError(404, 'NOT_FOUND', 'Resource not found.'); }
