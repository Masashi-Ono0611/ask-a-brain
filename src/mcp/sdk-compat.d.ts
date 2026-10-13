/** SDK 1.32.1 refers to a DOM-only global HeadersInit. Node 24 already supplies
 * RequestInit.headers. Ambient type-only adapter keeps ES2023/no-DOM unchanged.
 * CONTRACT REQUEST: T0 should own this compatibility alias or an upstream fix. */
type HeadersInit = NonNullable<RequestInit['headers']>;
