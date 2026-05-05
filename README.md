# YACReaderWeb

YACReaderWeb is a browser based comic book reader that relies on the excellent and simple YACReaderLibrary. It depends on it for libraries, comics, pages, and cover data.  You can use it at the same time as existing Yacreader clients with the same library.

I have run the docker version of the library server for years, but wanted a web based reader, so I created this project.  My kids use their iPads, but sometimes I'd like to read a comic without having to install something on the machine I'm using.

This container provides a comic browser, reader, zoom, spread mode, CBZ download, PWA install support, page persistence in the browser, and optional authentication.

Requirements:
- a running YACReaderLibraryServer backend

Docker Vars:
- `YACR_SERVER_URL` pointing at that backend
- `WEBREADER_PORT` for the web UI port

Optional authentication:
- set `WEBREADER_BASIC_AUTH_USERNAME`
- set `WEBREADER_BASIC_AUTH_PASSWORD`
- if both are set, every route is protected
- if either is unset, authentication is disabled
- logout is available via `/logout` and from the root/library shell logout button

Note: YACReaderWeb is a browser-based sidecar, it does not replace YACReaderLibrary(Server). 



