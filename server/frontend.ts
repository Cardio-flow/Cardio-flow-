import type { Express } from "express";
import path from "node:path";

// Vercel's Express preset discovers CDN static files from uploaded inputs.
// Our hashed files are generated during the build, so also serve them explicitly
// from the function's included public directory. Never send HTML for an asset.
export function mountFrontend(app: Express, directory: string) {
  app.get("/assets/:file", (req, res) => {
    const file = String(req.params.file);
    if (!/^[A-Za-z0-9_-]+\.(js|css|woff2?|png|jpe?g|webp|svg)$/.test(file)) {
      res.status(404).type("text/plain").send("File not found");
      return;
    }
    res.set("X-Content-Type-Options", "nosniff");
    res.sendFile(
      file,
      {
        root: path.join(directory, "assets"),
        maxAge: "1y",
        immutable: true,
      },
      (error) => {
        if (error && !res.headersSent) {
          res.set("Cache-Control", "no-store");
          res.status(404).type("text/plain").send("File not found");
        }
      },
    );
  });
  app.get("/{*path}", (req, res) => {
    if (path.extname(req.path) && req.path !== "/index.html") {
      res.status(404).type("text/plain").send("File not found");
      return;
    }
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(directory, "index.html"), {
      cacheControl: false,
      lastModified: false,
    });
  });
}
