// Stand-in for env-validation packages (@t3-oss/env-*, envalid, …) when rendering a
// component for a prototype: those packages exist to throw at import time when the app's
// secrets are absent, which they always are here. Every variable reads as an empty string.
const proxy = () => new Proxy({}, { get: (_, k) => (k === "__esModule" ? true : "") });
export const createEnv = proxy;
export const cleanEnv = proxy;
export default proxy;
