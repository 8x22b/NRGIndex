const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { normalizeProxyUrl, maskProxyUrl, proxiedFetch } = require("../../server/lib/proxy");
const { transcribeAudio } = require("../../server/lib/ai");

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

test("normalizeProxyUrl: схемы, пустое значение, мусор", () => {
  assert.equal(normalizeProxyUrl(""), "");
  assert.equal(normalizeProxyUrl("  http://u:p@proxy.local:3128/ "), "http://u:p@proxy.local:3128");
  assert.equal(normalizeProxyUrl("socks5://10.0.0.1:1080"), "socks5://10.0.0.1:1080");
  assert.throws(() => normalizeProxyUrl("ftp://x:21"), /http, https или socks5/);
  assert.throws(() => normalizeProxyUrl("proxy:3128"), /Прокси/);
  assert.throws(() => normalizeProxyUrl("http://h:1/path"), /без пути/);
  assert.throws(() => normalizeProxyUrl("http://u:***@h:1"), /пароль/);
});

test("maskProxyUrl прячет пароль, но не логин", () => {
  assert.equal(maskProxyUrl("http://user:secret@h:3128"), "http://user:***@h:3128");
  assert.equal(maskProxyUrl("socks5://h:1080"), "socks5://h:1080");
  assert.equal(maskProxyUrl(""), "");
});

test("proxiedFetch без прокси — обычный fetch", () => {
  assert.equal(proxiedFetch(""), fetch);
});

test("proxiedFetch ходит через HTTP-прокси с авторизацией, multipart не ломается", async (t) => {
  const seen = [];
  // простой forward-прокси: для http:// целей undici шлёт абсолютный URL
  const proxy = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers["proxy-authorization"] });
    const target = new URL(req.url);
    const upstream = http.request(
      { host: target.hostname, port: target.port, path: target.pathname, method: req.method, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );
    req.pipe(upstream);
  });
  proxy.on("connect", (req, socket) => {
    // CONNECT-туннель: undici использует его и для http-целей (proxyTunnel: true)
    seen.push({ url: req.url, auth: req.headers["proxy-authorization"] });
    const [host, port] = req.url.split(":");
    const upstream = require("node:net").connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
  });
  const api = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("latin1");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          text: `ct=${String(req.headers["content-type"]).split(";")[0]} model=${/name="model"\r\n\r\n([^\r]+)/.exec(body)?.[1]}`,
        }),
      );
    });
  });
  const proxyPort = await listen(proxy);
  const apiPort = await listen(api);
  t.after(() => {
    proxy.close();
    api.close();
  });

  const fetchImpl = proxiedFetch(`http://nrg:s3cret@127.0.0.1:${proxyPort}`);
  const text = await transcribeAudio(Buffer.alloc(400, 7), "audio/webm", {
    key: "k",
    baseUrl: `http://127.0.0.1:${apiPort}/v1`,
    fetchImpl,
  });
  assert.equal(text, "ct=multipart/form-data model=openai/whisper-large-v3-turbo");
  assert.ok(seen.length >= 1, "запрос прошёл через прокси");
  assert.equal(seen[0].auth, `Basic ${Buffer.from("nrg:s3cret").toString("base64")}`);
});

test("proxiedFetch: недоступный прокси — понятная ошибка", async () => {
  const fetchImpl = proxiedFetch("http://127.0.0.1:1");
  await assert.rejects(() => fetchImpl("http://127.0.0.1:2/x"), /^Error: прокси:/);
});
