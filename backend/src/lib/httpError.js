export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const badRequest = (m, code = "VALIDATION_ERROR") => new HttpError(400, code, m);
export const unauthorized = (m = "Please sign in.") => new HttpError(401, "UNAUTHENTICATED", m);
export const forbidden = (m = "Not allowed.", code = "FORBIDDEN") => new HttpError(403, code, m);
export const notFound = (m = "Not found.") => new HttpError(404, "NOT_FOUND", m);
export const conflict = (m, code = "CONFLICT") => new HttpError(409, code, m);
