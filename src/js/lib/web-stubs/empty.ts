/*
  Empty shim used by the browser bundle (esbuild alias) for Node-only
  modules (fs, graceful-fs, crypto, rimraf) that get pulled in by
  shared library files at module-load time but are never actually called
  in the web code path.

  Anything that does call these at runtime would throw — that's a sign
  to refactor the call site behind the Platform interface.
*/

const stub: unknown = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'default') return stub;
    if (prop === '__esModule') return true;
    return () => {
      throw new Error(`Node module accessed in browser bundle: ${String(prop)}`);
    };
  },
});

export default stub;
