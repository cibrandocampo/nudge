// Imperative bridge between the api client (not a React component) and
// the AppVersionProvider. The provider registers its publisher on mount;
// the api client calls `publishRemoteVersion(remote)` after every fetch.
// When no provider is mounted, publishes are silently no-op.
let publish = null

export function registerAppVersionPublisher(fn) {
  publish = fn
  return () => {
    if (publish === fn) publish = null
  }
}

export function publishRemoteVersion(version) {
  if (publish && version) publish(version)
}
