// Request checks for the local API. Pure functions, so they can be tested without starting the server.
const HOST_OK = /^(127\.0\.0\.1|localhost)(:\d+)?$/
const ORIGIN_OK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/

/** Anti DNS-rebinding: only answer requests addressed to the loopback name. */
export const isLoopbackHost = (host: string | undefined) => HOST_OK.test(host ?? '')

/**
 * Actions can start processes and run tools. Same-origin only (an absent Origin is allowed: it is not a browser
 * cross-site request), and a custom header forces a CORS preflight that the server never grants.
 */
export const isAllowedPost = (origin: string | undefined, iceHeader: string | string[] | undefined) =>
  (!origin || ORIGIN_OK.test(origin)) && iceHeader === '1'
