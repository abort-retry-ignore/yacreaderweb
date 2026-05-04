# YACReaderWeb

YACReaderWeb is a browser based comic book reader that relies on the excellent and simple YACReaderLibrary.

I have run the docker version of the library server for years, but wanted a web based reader, so I created this project.  My kids use their iPads, but sometimes I'd like to read a comic without having to install something on the machine I'm using.

This container provides a comic browser, reader, zoom, spread mode, CBZ download, PWA install support, and page persistence in the browser.  Currently, it provides no login at all, just like YacReaderLibraryServer.  You'll want to run it locally or via VPN only.  I use tailscale to access it when not at home.

Requirements:
- a running YACReaderLibraryServer backend
- `YACR_SERVER_URL` pointing at that backend
- `WEBREADER_PORT` for the web UI port

YACReaderWeb is a browser-based sidecar, it does not replace YACReaderLibrary(Server). It depends on it for libraries, comics, pages, and cover data.  You can use it at the same time as existing Yacreader clients with the same library.

Future enhancements will include user authentication, so you can place your library behind a proxy and host on the internet with SSL.





