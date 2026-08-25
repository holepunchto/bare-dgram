module.exports = class DgramError extends Error {
  constructor(msg, fn = DgramError, code = fn.name) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'DgramError'
  }

  static SOCKET_ALREADY_BOUND(msg) {
    return new DgramError(msg, DgramError.SOCKET_ALREADY_BOUND)
  }

  static SOCKET_ALREADY_CONNECTED(msg) {
    return new DgramError(msg, DgramError.SOCKET_ALREADY_CONNECTED)
  }

  static SOCKET_NOT_BOUND(msg) {
    return new DgramError(msg, DgramError.SOCKET_NOT_BOUND)
  }

  static SOCKET_NOT_CONNECTED(msg) {
    return new DgramError(msg, DgramError.SOCKET_NOT_CONNECTED)
  }

  static SOCKET_IS_CLOSED(msg) {
    return new DgramError(msg, DgramError.SOCKET_IS_CLOSED)
  }

  static INVALID_ARGUMENT(msg) {
    return new DgramError(msg, DgramError.INVALID_ARGUMENT)
  }

  static INVALID_FD(msg) {
    return new DgramError(msg, DgramError.INVALID_FD)
  }

  static INVALID_HOST(msg = 'Unrecognizable host format') {
    return new DgramError(msg, DgramError.INVALID_HOST)
  }

  static INVALID_PORT(msg) {
    return new DgramError(msg, DgramError.INVALID_PORT)
  }

  static INVALID_SOCKET_TYPE(msg) {
    return new DgramError(msg, DgramError.INVALID_SOCKET_TYPE)
  }
}
