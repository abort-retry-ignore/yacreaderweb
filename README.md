# YACReaderWeb

YACReaderWeb is a browser-based sidecar for YACReaderLibraryServer.

It provides a comic browser, reader, zoom, spread mode, CBZ download, PWA install support, and page persistence in the browser.

Requirements:
- a running YACReaderLibraryServer backend
- `YACR_SERVER_URL` pointing at that backend
- `WEBREADER_PORT` for the web UI port

YACReaderWeb does not replace YACReaderLibraryServer. It depends on it for libraries, comics, pages, and cover data.
