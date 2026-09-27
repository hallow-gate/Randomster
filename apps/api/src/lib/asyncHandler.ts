import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 does not catch a rejected promise thrown by an `async` route
 * handler — it never reaches the `next(err)` error middleware in index.ts.
 * Node treats it as an unhandled promise rejection and, depending on the
 * runtime, that can bring the entire process down: one broadcaster hitting
 * a bad query (e.g. a column that doesn't exist yet, a stale connection)
 * kills the server for every other user mid-stream, not just that one
 * request.
 *
 * Wrapping a handler in `asyncHandler(...)` catches the rejection and
 * forwards it to `next(err)`, so a single failing request gets the normal
 * centralized 500 response instead of taking the whole API down.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Req, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
