# Own profile persistence in the main process

The Electron main process owns the versioned, atomically written profile document in `userData`, including full private-key file paths, while the renderer receives only typed profile projections, display labels, and opaque identities through IPC. Profile data is plain local app data protected by restrictive operating-system permissions because it contains no Authentication Secrets; keeping full paths and file reads out of the renderer preserves the existing narrow preload boundary.
