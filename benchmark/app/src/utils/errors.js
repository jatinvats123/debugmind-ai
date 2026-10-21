/**
 * Errors that carry an HTTP status. Routes pass them to next(err) and the
 * app-level error handler turns them into JSON responses.
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
  }
}

class ValidationError extends HttpError {
  constructor(message) {
    super(400, message);
  }
}

module.exports = { HttpError, ValidationError };
