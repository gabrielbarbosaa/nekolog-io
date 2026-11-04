---
"@nekolog-io/adapters": minor
"@nekolog-io/cli": minor
---

Upload the maps.

`@nekolog-io/cli` gains `nekolog sourcemaps upload <version> --dir dist`. It
walks the build, takes every `.map`, flattens a nested path into one safe name,
skips `node_modules` and dotted folders, and posts each file. The same three
refusals as `releases create` happen before it opens a socket, and a map over
the limit is skipped and named rather than silently dropped.

`@nekolog-io/adapters` gains `SourceMapStore`, `blobSourceMapStore` and the
validation beside it. **The store is built on `BlobStore`**, so the same code
writes to an R2 bucket on Cloudflare and to a directory in a self-host: the
application receives the bytes itself, which is why this works where exports
could not. The key is `sourcemaps/<projectId>/<releaseId>/<name>` — the release
**id**, never the version, because a version may legally hold a slash and an id
is Crockford by construction.

**The body is checked, not parsed.** The first 4 KB must open a JSON object and
name `mappings` or `sections`, and a declared `version` must be 3. Parsing
megabytes of JSON does not fit a Worker's CPU budget, and the map is parsed
where it is used.

`ReleaseStore` gains `byVersion` and `countSourceMaps`, so an upload can only
land against a release that exists and the count on it stays true.
