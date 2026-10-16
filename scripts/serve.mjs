// Tiny static server for local preview: npm run dev → http://localhost:4173/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { path, readJSON } from "./lib/util.mjs";

const site = await readJSON(path("config", "site.json"));
const base = new URL(process.env.SITE_URL || site.url).pathname;
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain" };

createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.startsWith(base)) p = "/" + p.slice(base.length);
  let file = join(path("dist"), normalize(p).replace(/^(\.\.[/\\])+/, ""));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/html" });
    res.end(await readFile(join(path("dist"), "404.html")).catch(() => "Not found"));
  }
}).listen(port, () => console.log(`Preview: http://localhost:${port}${base}`));
