# Simple HTML Hoster

A tiny self-hosted static-site manager for Docker/Portainer.

## Features
- Basic-auth protected admin page
- Create project
- Upload a single HTML file or ZIP
- Replace an existing project
- Browse files
- Edit HTML/CSS/JS/JSON/text/SVG in-browser
- Delete project
- Serve every project at `/<slug>/`
- Persistent Docker volume

## Portainer
1. Put these files in a Git repo OR build them on the server.
2. Deploy the included `docker-compose.yml` as a stack.
3. Change `ADMIN_PASSWORD` before deployment.
4. Open `http://SERVER_IP:3080/admin`.
5. Username can be anything; the password is `ADMIN_PASSWORD`.
6. In Nginx Proxy Manager, proxy your hostname to `http://SERVER_IP:3080`.

## ZIP requirement
The ZIP must have `index.html` at its root.

Correct:
```
index.html
style.css
app.js
assets/logo.png
```

Not ideal:
```
my-project/index.html
```

## Security note
This is intended for trusted static HTML/CSS/JS projects. Uploaded JavaScript executes in visitors' browsers under the same host origin. For untrusted users or strong per-project isolation, use separate origins/subdomains and stricter sandboxing.
