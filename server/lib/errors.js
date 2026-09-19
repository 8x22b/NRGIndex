class ApiError extends Error {
  constructor(status, message, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const badRequest = (message, code = "bad_request") => new ApiError(400, message, code);
const unauthorized = (message = "Требуется вход", code = "unauthorized") =>
  new ApiError(401, message, code);
const forbidden = (message = "Недостаточно прав", code = "forbidden") =>
  new ApiError(403, message, code);
const notFound = (message = "Не найдено", code = "not_found") => new ApiError(404, message, code);
const conflict = (message, code = "conflict") => new ApiError(409, message, code);
const tooMany = (message = "Слишком много попыток", code = "rate_limited") =>
  new ApiError(429, message, code);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany };
