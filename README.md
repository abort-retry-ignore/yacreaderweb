# YACReaderWeb

YACReaderWeb is a browser based comic book reader that relies on the excellent YACReaderLibraryServer.  

It provides a comic browser, reader, zoom, spread mode, CBZ download, PWA install support, and page persistence in the browser.  Currently, it provides no security at all, just like YacReaderLibraryServer.  You'll want to run it locally or via VPN only.  I use tailscale.

Requirements:
- a running YACReaderLibraryServer backend
- `YACR_SERVER_URL` pointing at that backend
- `WEBREADER_PORT` for the web UI port

YACReaderWeb is a browser-based sidecar, it does not replace YACReaderLibraryServer. It depends on it for libraries, comics, pages, and cover data.  You can use it at the same time as existing Yakreadaer clients with the same library.


