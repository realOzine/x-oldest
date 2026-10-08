// Every failure carries a `kind`, so the UI can tell "nothing found" from "could not look".
//   incompatible  X's page no longer has what we rely on
//   auth          not signed in, or the session was rejected
//   rate          rate limited; `resetAt` (ms) says when to try again
//   http          network failure or unexpected HTTP status
//   api           HTTP 200 whose body reports an error
//   parse         a response we could not read
//   unavailable   the account cannot be read
//   cancelled     the reader was cancelled while a request was in flight
export class XoError extends Error {
  constructor(kind, message, extra) {
    super(message || kind);
    this.kind = kind;
    Object.assign(this, extra);
  }
}
