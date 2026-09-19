const fs = require("fs");
const path = require("path");
const http = require("http");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function collectRefs() {
  const refs = new Set(["/", "/index.html", "/cabinet.html", "/keys.js"]);
  for (const file of ["index.html", "cabinet.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^(#|https?:|mailto:|tel:|\/\/)/.test(ref)) continue;
      const clean = ref.split("#")[0].split("?")[0];
      if (clean) refs.add("/" + clean);
    }
  }
  const context = vm.createContext({ window: {} });
  for (const file of ["data.js", "participants.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  for (const drink of context.window.NRG_DATA?.drinks || []) {
    if (drink.image) refs.add("/" + drink.image);
  }
  return [...refs];
}

function createServer() {
  return http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end("bad request");
      return;
    }
    const target = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!path.resolve(target).startsWith(path.resolve(ROOT))) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(target, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
      res.end(data);
    });
  });
}

function fetchHttp(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
  });
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, "keys.js"))) {
    console.error("smoke-test: keys.js отсутствует — сначала выполните node scripts/build-config.js");
    process.exit(1);
  }

  const refs = collectRefs();
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const errors = [];
  for (const ref of refs) {
    try {
      const { status, body } = await fetchHttp(port, ref);
      if (status !== 200) {
        errors.push(`${ref} -> HTTP ${status}`);
        continue;
      }
      if (!body.length) {
        errors.push(`${ref} -> пустой ответ`);
        continue;
      }
      if (ref.endsWith(".html") && !body.toString("utf8").includes("<html")) {
        errors.push(`${ref} -> ответ не похож на HTML`);
      }
    } catch (e) {
      errors.push(`${ref} -> ${e.message}`);
    }
  }

  server.close();

  if (errors.length) {
    console.error(`smoke-test: найдено ${errors.length} ошибок:`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }

  console.log(`smoke-test: OK — ${refs.length} URL отдаются корректно (раздача сайта работает).`);
})();
