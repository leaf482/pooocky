import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function resolveStatic(rootDir, urlPath) {
  let url = "/";
  try {
    url = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch {
    return null;
  }
  if (url.includes("\0")) return null;
  const rel = url === "/" ? "index.html" : url.replace(/^[/\\]+/, "");
  const file = normalize(join(rootDir, rel));
  const fromRoot = relative(rootDir, file);
  if (!fromRoot || fromRoot.startsWith("..") || fromRoot.split(sep).includes("..") || isAbsolute(fromRoot)) {
    return null;
  }
  if (!types[extname(file).toLowerCase()]) return null;
  return file;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url.toLowerCase() === pathToFileURL(entry).href.toLowerCase();
}

if (invokedDirectly()) {
  const port = Number(process.argv[2] || 8765);
  createServer(async (req, res) => {
    try {
      const file = resolveStatic(root, req.url);
      if (!file) {
        res.writeHead(403);
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": types[extname(file).toLowerCase()],
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
      res.end(body);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end("not found");
    }
  }).listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${port}`);
  });
}
