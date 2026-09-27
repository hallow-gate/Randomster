import type { NextFunction, Request, Response, Router } from "express";

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
    // `Promise.resolve(...)` instead of calling `.catch` directly on the
    // return value: this router also wraps synchronous-style middleware
    // (rate limiters, validateBody) that call `next()` themselves and
    // return `undefined`, not a promise. Calling `.catch` on `undefined`
    // throws synchronously, which Express turns into a *second* response
    // after the real handler already sent one (ERR_HTTP_HEADERS_SENT).
    // Promise.resolve(undefined) is a no-op, so sync middleware is
    // unaffected and only a genuinely rejected async handler reaches `next`.
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Applies `asyncHandler` to every handler registered on a router from this
 * point on — `get`/`post`/`patch`/`delete` *and* `use` (`requireAuth` and
 * requireNotBanned` are async functions attached via `.use()` on nearly
 * every router in this app, so `use` has to be covered too, not just the
 * verb methods).
 *
 * Call this immediately after `Router()`, before registering any routes, so
 * every handler on that router — including ones added later — is covered.
 * This replaces the router being passed in in-place; the returned value is
 * the same instance, returned only for convenience.
 */
export function wrapRouterAsync<R extends Router>(router: R): R {
  for (const method of ["get", "post", "patch", "delete", "use"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (router[method] as any).bind(router);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (router as any)[method] = (path: unknown, ...handlers: unknown[]) => {
      // `.use()` can be called as `use(middleware)` with no path, so `path`
      // itself might be a handler rather than a route string.
      const isPathArg = typeof path === "string";
      const allHandlers = isPathArg ? handlers : [path, ...handlers];
      const wrapped = allHandlers.map((h) => (typeof h === "function" ? asyncHandler(h as Parameters<typeof asyncHandler>[0]) : h));
      return isPathArg ? original(path, ...wrapped) : original(...wrapped);
    };
  }
  return router;
}
