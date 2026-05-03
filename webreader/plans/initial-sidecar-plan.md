# YACReaderWeb Sidecar Plan

## Goal

Create a new `YACReaderWeb` sidecar application that runs in its own Docker container and provides a browser-based UI for reading data from `YACReaderLibraryServer`.

The first milestone is intentionally small:

- start YACReaderWeb in its own container
- make its HTTP port configurable
- fetch the list of libraries, folders, and comics from `YACReaderLibraryServer`
- display that list in a browser

## Upstream Findings

Inspection of `~/dev/yacreader` shows that the real HTTP API lives in `YACReaderLibrary/server/`, with routing centered in `YACReaderLibrary/server/requestmapper.cpp`.

Important conclusions:

- there is already a usable HTTP API for library navigation
- there is already a page-by-page image API for reading
- there is no meaningful built-in browser reader UI
- reading requests rely on an `x-request-id` header for in-memory session state
- some endpoints return JSON, some return plain text, and some are inconsistent in content type

## Scope For Initial Milestone

In scope:

- a new `webreader/` app directory
- a dedicated Dockerfile for the sidecar
- environment-based configuration for the YACReaderWeb port
- environment-based configuration for the upstream YACReader server URL
- server-side integration with YACReaderLibraryServer APIs
- a simple browser UI that lists libraries, folders, and comics
- upstream request handling that hides YACReader protocol quirks from the browser

Out of scope for this milestone:

- page rendering in the browser
- authentication and user accounts
- reading progress sync
- thumbnails, covers, and caching
- write operations back to YACReaderLibraryServer

## Architecture

The YACReaderWeb should be a separate service that talks to `YACReaderLibraryServer` over HTTP.

Required runtime configuration:

- `WEBREADER_PORT`: port the sidecar listens on
- `YACR_SERVER_URL`: base URL for `YACReaderLibraryServer`, for example `http://yacreaderlibrary-server-docker:8080`

Recommended container relationship:

- both containers share a Docker network
- YACReaderWeb does not need direct access to `/comics` for the first milestone
- YACReaderWeb uses the upstream API rather than scanning files itself
- the browser should talk only to the sidecar, not directly to YACReader

## Integration Strategy

YACReaderWeb should act as a thin adapter in front of the upstream API.

Responsibilities of the sidecar:

- normalize upstream responses into browser-friendly data
- hide `x-request-id` session management from the browser UI
- absorb future upstream quirks in one place
- optionally proxy images and page responses later

## API Assumptions

Based on upstream inspection, the sidecar can build the initial UI on top of these routes:

- `/v2/libraries`
- `/v2/library/<id>/folder/<id>/content`
- `/v2/library/<id>/cover/<path>`
- `/v2/library/<id>/comic/<id>/fullinfo`

Avoid using the legacy text endpoints for the first browser version unless there is a gap in the JSON APIs.

Known upstream route behavior that matters later:

- `GET /v2/library/<id>/comic/<id>/remote` opens a comic for remote reading
- `GET /v2/library/<id>/comic/<id>/page/<n>/remote` returns an individual page as `image/jpeg`
- page requests may temporarily return `412 opening file` or `412 loading page` while the server prepares the comic
- `POST /v2/library/<id>/comic/<id>/update` can later be used to persist reading progress

## Session Handling

The upstream server uses an `x-request-id` header as a lightweight in-memory session key.

For the initial milestone:

- generate one stable request id per browser session
- attach that header to all proxied upstream requests for consistency
- keep request-id handling inside the sidecar, not in browser code

This is not strictly required for listing views, but it should be built into the sidecar client from the start because it is required for opening comics and fetching pages.

The implementation should isolate all upstream calls behind a small adapter so later milestones can handle protocol quirks, request headers, and retries in one place.

## Initial UI

The first UI only needs to prove browser access to the library.

Minimum behavior:

- show available libraries
- allow selecting a library
- show folder contents for the selected location
- distinguish folders from comics
- allow navigating into folders
- show a stable list view in the browser
- optionally show covers if the upstream cover path is easy to wire in the first pass

Minimum display fields if available from the API:

- library name
- folder name
- comic title or filename
- issue number or volume only if already present in the response

## Suggested Implementation Shape

Keep the first version small.

- backend: lightweight HTTP service that proxies and normalizes YACReader responses
- frontend: server-rendered HTML or a very small SPA
- module boundary: one upstream API client, one route/controller layer, one presentation layer

Preferred sequence:

1. Create the `webreader/` application skeleton.
2. Add a config module for `WEBREADER_PORT` and `YACR_SERVER_URL`.
3. Implement a YACReader API client for library and folder listing, with automatic `x-request-id` handling.
4. Expose YACReaderWeb routes such as `/`, `/libraries/:id`, and `/libraries/:id/folders/:folderId`.
5. Render a simple list UI in the browser.
6. Add Docker support and an example compose snippet.

If the first pass stays small, covers can be added as step 7.

## Docker Requirements

YACReaderWeb must run as its own container.

Deliverables:

- `webreader/Dockerfile`
- optional `.dockerignore` inside `webreader/` if useful
- documented environment variables
- example compose service showing configurable host and container port mapping

Example shape:

```yaml
services:
  yacreaderlibrary-server-docker:
    image: xthursdayx/yacreaderlibrary-server-docker:latest
    ports:
      - "8080:8080"

  webreader:
    build: ./webreader
    environment:
      - WEBREADER_PORT=3000
      - YACR_SERVER_URL=http://yacreaderlibrary-server-docker:8080
    ports:
      - "3000:3000"
```

## Risks

- YACReaderLibraryServer requires `x-request-id` for remote reading flows.
- Folder and comic payloads are not browser-first and may need normalization.
- Some upstream endpoints use mixed or misleading content types.
- Page reads are asynchronous and require retry behavior.
- Upstream route behavior may differ across YACReader versions.

## Milestone After This One

After the list view works in the browser, the next milestone should open a comic and display individual pages by integrating the upstream remote reading endpoints.

That milestone should:

- open a comic with `/v2/library/<id>/comic/<id>/remote`
- fetch pages with `/v2/library/<id>/comic/<id>/page/<n>/remote`
- retry on `412 opening file` and `412 loading page`
- persist reading progress with `POST /v2/library/<id>/comic/<id>/update`
