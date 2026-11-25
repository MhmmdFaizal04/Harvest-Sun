import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

try { process.loadEnvFile(); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const { default: game } = await import("./api/game.js");
const root = fileURLToPath(new URL("./public", import.meta.url));
const types = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".png":"image/png", ".webp":"image/webp", ".json":"application/json" };
const port = Number(process.env.PORT || 4173);
createServer(async (req,res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/game") {
    if (req.method === "POST") {
      let body = "";
      for await (const bytes of req) {
        body += bytes.toString();
        if (body.length > 8192) {
          res.writeHead(413).end();
          return;
        }
      }
      req.body = body;
    }
    return game(req,res);
  }
  try {
    const file = resolve(root, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep)) return res.writeHead(404).end();
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
    res.end(bytes);
  } catch { res.writeHead(404).end(); }
}).listen(port, process.env.HOST || "127.0.0.1", () => console.log(`Harvest Sun · http://127.0.0.1:${port}`));
