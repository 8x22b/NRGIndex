const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { startServer, createUser, request, login } = require("./helpers");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function listServerFiles() {
  const files = [];
  for (const dir of ["server", path.join("server", "lib"), path.join("server", "routes")]) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith(".js")) files.push(path.join(dir, name));
    }
  }
  return files;
}

/* ---------- статический анализ ---------- */

test("security: нет eval, child_process и прочих опасных вызовов в сервере", () => {
  const forbidden = [
    [/require\(\s*["']node:child_process["']\s*\)/, "импорт child_process"],
    [/(?<![.\w$])eval\s*\(/, "eval("],
    [/new\s+Function\s*\(/, "new Function"],
    [/\bexecSync\s*\(/, "execSync("],
    [/\bexecFile\s*\(/, "execFile("],
    [/\bchild_process\b/, "child_process"],
    [/\bspawn\s*\(/, "spawn("],
  ];
  const problems = [];
  for (const file of listServerFiles()) {
    read(file)
      .split("\n")
      .forEach((line, index) => {
        for (const [re, label] of forbidden) {
          if (re.test(line)) problems.push(`${file}:${index + 1}: ${label}`);
        }
      });
  }
  assert.equal(problems.length, 0, `Опасные вызовы:\n${problems.join("\n")}`);
});

test("security: SQL собирается только из безопасных идентификаторов", () => {
  const SAFE = new Set([
    "table",
    "cols",
    "c",
    "column",
    "columns",
    "sets",
    "where",
    "order",
    "limit",
    "offset",
    "values",
    "placeholders",
    "sql",
    "query",
    "join",
  ]);
  const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|PRAGMA|CREATE|WITH|ALTER|DROP)\b/i;
  const USER_INPUT = /\$\{\s*(req|request|body|query|params|session|input|term|search|value)\b/;
  const problems = [];
  for (const file of listServerFiles()) {
    const parts = read(file).split(/\.(?:prepare|exec)\s*\(/).slice(1);
    parts.forEach((part, index) => {
      const quoteMatch = part.match(/^\s*(["'`])/);
      if (!quoteMatch) return;
      const quote = quoteMatch[1];
      const start = quoteMatch[0].length;
      const end = part.indexOf(quote, start);
      if (end < 0) return;
      const sql = part.slice(start, end);
      if (!SQL_START.test(sql)) return;
      const fragment = `фрагмент #${index + 1}`;
      if (USER_INPUT.test(sql)) {
        problems.push(`${file}: SQL содержит пользовательский ввод (${fragment})`);
      }
      for (const match of sql.matchAll(/\$\{\s*([A-Za-z_$][\w$]*)/g)) {
        const ident = match[1];
        // разрешаем только известные безопасные идентификаторы и КОНСТАНТЫ_С_БОЛЬШИХ_БУКВ
        if (SAFE.has(ident) || /^[A-Z][A-Z0-9_]*$/.test(ident)) continue;
        problems.push(`${file}: неизвестная интерполяция \${${ident}} в SQL (${fragment})`);
      }
    });
  }
  assert.equal(problems.length, 0, `Небезопасный SQL:\n${problems.join("\n")}`);
});

test("security: в коде нет захардкоженных секретов", () => {
  const patterns = [
    [/sk-or-[A-Za-z0-9]{20,}/, "ключ OpenRouter"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "приватный ключ"],
    [/ghp_[A-Za-z0-9]{30,}/, "GitHub PAT"],
    [/github_pat_[A-Za-z0-9_]{30,}/, "GitHub fine-grained PAT"],
    [/NRG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/, "ключ входа NRG"],
  ];
  const files = [
    ...listServerFiles(),
    "public/app.js",
    "public/cabinet.js",
    "admin/admin.js",
    "scripts/create-admin.js",
  ];
  const problems = [];
  for (const file of files) {
    read(file)
      .split("\n")
      .forEach((line, index) => {
        if (line.includes("XXXX")) return; // плейсхолдеры формата
        for (const [re, label] of patterns) {
          if (re.test(line)) problems.push(`${file}:${index + 1}: похоже на ${label}`);
        }
      });
  }
  assert.equal(problems.length, 0, `Секреты в коде:\n${problems.join("\n")}`);
});

test("security: пароли, сессии и cookie настроены безопасно", () => {
  const auth = read(path.join("server", "auth.js"));
  assert.match(auth, /N:\s*32768/, "scrypt N должен быть не меньше 32768");
  assert.match(auth, /timingSafeEqual/, "сравнение хешей должно быть постоянным по времени");
  assert.match(auth, /createHash\(["']sha256["']\)/, "токен сессии должен храниться как sha256");
  assert.match(auth, /httpOnly:\s*true/, "cookie должна быть httpOnly");
  assert.match(auth, /sameSite:\s*["']lax["']/, "cookie должна быть SameSite=Lax");
  assert.match(auth, /secure:/, "cookie должна учитывать Secure");
  assert.match(auth, /sessionIdleDays/, "должно быть истечение по простою");
});

test("security: CSRF-защита включена", () => {
  const app = read(path.join("server", "app.js"));
  assert.match(app, /x-nrg-request/, "нужен обязательный заголовок X-NRG-Request");
  assert.match(app, /new URL\(origin\)/, "нужна проверка Origin");
});

test("security: загрузки валидируются по типу, сигнатуре и размеру", () => {
  const validate = read(path.join("server", "lib", "validate.js"));
  assert.match(validate, /MAGIC/, "проверка сигнатуры файла");
  assert.match(validate, /maxBytes/, "ограничение размера");
  const types = validate.match(/const IMAGE_TYPES = \{([^}]*)\}/);
  assert.ok(types, "IMAGE_TYPES должен быть описан в validate.js");
  const mimes = [...types[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
    assert.ok(mimes.includes(mime), `${mime} должен быть разрешён`);
  }
  assert.ok(!mimes.some((mime) => mime.includes("svg")), "SVG не должен входить в белый список");
});

test("security: клиент экранирует значения атрибутов в HTML", () => {
  const ALLOWED_CALL = /^(?:esc|safeColor|encodeURIComponent|Number|String)\(/;
  const ALLOWED_IDENT = new Set([
    "accent",
    "index",
    "id",
    "drink.id",
    "user.id",
    "tier.id",
    "row.id",
    "item.dataUrl",
  ]);
  const problems = [];
  for (const file of ["public/app.js", "public/cabinet.js", "admin/admin.js"]) {
    read(file)
      .split("\n")
      .forEach((line, lineIndex) => {
        for (const match of line.matchAll(
          /(?:src|href|style|alt|title|data-[a-z-]+)="\$\{([^}]*)\}/g,
        )) {
          const expr = match[1].trim();
          if (ALLOWED_CALL.test(expr) || ALLOWED_IDENT.has(expr)) continue;
          problems.push(`${file}:${lineIndex + 1}: без экранирования → \${${expr}}`);
        }
      });
  }
  assert.equal(problems.length, 0, `Неэкранированные подстановки:\n${problems.join("\n")}`);
});

/* ---------- динамические проверки ---------- */

let ctx;
let adminCookie;
let editorCookie;
let userCookie;
let otherCookie;

before(async () => {
  ctx = await startServer();
  await createUser(ctx.db, { username: "admin", password: "admin-pass-123", role: "admin", displayName: "Админ" });
  await createUser(ctx.db, { username: "editor", password: "editor-pass-123", role: "editor" });
  await createUser(ctx.db, { username: "sanya", password: "sanya-pass-123", role: "user" });
  await createUser(ctx.db, { username: "other", password: "other-pass-123", role: "user" });
  adminCookie = (await login(ctx.base, "admin", "admin-pass-123")).cookie;
  editorCookie = (await login(ctx.base, "editor", "editor-pass-123")).cookie;
  userCookie = (await login(ctx.base, "sanya", "sanya-pass-123")).cookie;
  otherCookie = (await login(ctx.base, "other", "other-pass-123")).cookie;
});

after(() => ctx.close());

test("security: заголовки безопасности на страницах и API", async () => {
  const page = await fetch(`${ctx.base}/`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-powered-by"), null, "сервер не должен светить x-powered-by");
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  const csp = page.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  const api = await fetch(`${ctx.base}/api/health`);
  assert.equal(api.headers.get("cache-control"), "no-store");
});

test("security: матрица доступа для API и админ-страниц", async () => {
  const cases = [
    ["GET", "/api/admin/data", null, 401],
    ["GET", "/api/admin/data", userCookie, 403],
    ["GET", "/api/cabinet/me", null, 401],
    ["POST", "/api/uploads", null, 401],
    ["POST", "/api/admin/drinks", userCookie, 403],
    ["PUT", "/api/admin/settings", editorCookie, 403],
    ["DELETE", "/api/admin/users/1", editorCookie, 403],
  ];
  for (const [method, url, cookie, expected] of cases) {
    const res = await request(ctx.base, method, url, { cookie, body: method === "GET" ? undefined : {} });
    assert.equal(res.status, expected, `${method} ${url} → ${res.status}, ждали ${expected}`);
  }
  for (const url of ["/admin", "/admin.js"]) {
    const anon = await fetch(`${ctx.base}${url}`, { redirect: "manual" });
    assert.equal(anon.status, 302, `${url} для анонима`);
    const asUser = await fetch(`${ctx.base}${url}`, { headers: { cookie: userCookie }, redirect: "manual" });
    assert.equal(asUser.status, 302, `${url} для пользователя`);
  }
  const asAdmin = await fetch(`${ctx.base}/admin`, { headers: { cookie: adminCookie }, redirect: "manual" });
  assert.equal(asAdmin.status, 200, "админ должен открывать /admin");
});

test("security: мутации без CSRF-заголовка отклоняются", async () => {
  const mutations = [
    ["POST", "/api/auth/logout"],
    ["POST", "/api/cabinet/drinks"],
    ["PUT", "/api/cabinet/ratings/any"],
    ["POST", "/api/uploads"],
    ["PUT", "/api/admin/settings"],
    ["DELETE", "/api/admin/drinks/1"],
  ];
  for (const [method, url] of mutations) {
    const res = await request(ctx.base, method, url, { cookie: adminCookie, body: {}, csrf: false });
    assert.equal(res.status, 403, `${method} ${url} без заголовка → ${res.status}`);
  }
  const badOrigin = await request(ctx.base, "POST", "/api/auth/logout", {
    cookie: adminCookie,
    body: {},
    headers: { origin: "https://evil.example" },
  });
  assert.equal(badOrigin.status, 403, "чужой Origin должен отклоняться");
});

test("security: обход пути не работает", async () => {
  const targets = [
    "/uploads/..%2f..%2fpackage.json",
    "/uploads/%2e%2e/%2e%2e/etc/passwd",
    "/assets/..%2f..%2fserver%2fapp.js",
  ];
  for (const url of targets) {
    const res = await fetch(`${ctx.base}${url}`);
    assert.ok([403, 404].includes(res.status), `${url} → ${res.status}`);
  }
});

test("security: SQL-инъекции не проходят и не ломают API", async () => {
  for (const username of ["' OR 1=1 --", "'; DROP TABLE users; --", '" OR ""="']) {
    const res = await request(ctx.base, "POST", "/api/auth/login", {
      body: { username, password: "x" },
    });
    assert.ok([400, 401].includes(res.status), `${username} → ${res.status}`);
  }
  const slug = await request(ctx.base, "PUT", "/api/cabinet/ratings/x%27%20OR%201%3D1--", {
    cookie: userCookie,
    body: { tier: "S" },
  });
  assert.equal(slug.status, 404);
  const me = await request(ctx.base, "GET", "/api/auth/me", { cookie: adminCookie });
  assert.equal(me.json.user.username, "admin", "таблица users должна остаться рабочей");
});

test("security: вредоносные данные не попадают в HTML страниц", async () => {
  const payload = {
    brand: '<script>alert("brand")</script>',
    name: '<img src=x onerror="window.__xss=1">',
    flavor: '"><svg onload="window.__xss=2">',
    edition: "<iframe src=javascript:alert(3)>",
    review: "<body onload=window.__xss=4>",
  };
  const created = await request(ctx.base, "POST", "/api/admin/drinks", {
    cookie: adminCookie,
    body: payload,
  });
  assert.equal(created.status, 201);
  const summary = await (await fetch(`${ctx.base}/api/public/summary`)).text();
  assert.ok(summary.includes("onerror"), "API отдаёт данные как JSON (без исполнения)");
  const page = await (await fetch(`${ctx.base}/`)).text();
  for (const marker of ["__xss", "onerror=", "onload=", "<script>alert"]) {
    assert.ok(!page.includes(marker), `в HTML не должно быть ${marker}`);
  }
  await request(ctx.base, "DELETE", `/api/admin/drinks/${created.json.drink.id}`, {
    cookie: adminCookie,
  });
});

test("security: чужой напиток нельзя править или удалять", async () => {
  const mine = await request(ctx.base, "POST", "/api/cabinet/drinks", {
    cookie: userCookie,
    body: { brand: "IDOR", name: "IDOR Drink", flavor: "Тест", tier: "B" },
  });
  assert.equal(mine.status, 201);
  const slug = mine.json.drink.slug;
  const stolenDelete = await request(ctx.base, "DELETE", `/api/cabinet/drinks/${slug}`, {
    cookie: otherCookie,
  });
  assert.equal(stolenDelete.status, 404);
  const stolenPatch = await request(ctx.base, "PATCH", `/api/cabinet/drinks/${slug}`, {
    cookie: otherCookie,
    body: { brand: "Hack", name: "Hack", flavor: "x", tier: "S" },
  });
  assert.ok([403, 404].includes(stolenPatch.status));
  const own = await request(ctx.base, "DELETE", `/api/cabinet/drinks/${slug}`, {
    cookie: userCookie,
  });
  assert.equal(own.status, 200);
});

test("security: API не отдаёт хеши паролей и токены", async () => {
  const auth = await login(ctx.base, "admin", "admin-pass-123");
  const raw = JSON.stringify(auth.res.json);
  assert.ok(!raw.includes("scrypt$"), "хеш пароля не должен попадать в ответ");
  assert.ok(!raw.includes("password_hash"));
  const me = await request(ctx.base, "GET", "/api/auth/me", { cookie: adminCookie });
  assert.ok(!JSON.stringify(me.json).includes("scrypt$"));
});

test("security: cookie сессии помечена HttpOnly и SameSite", async () => {
  const auth = await login(ctx.base, "admin", "admin-pass-123");
  const cookies = (auth.res.setCookie || []).join("; ");
  assert.match(cookies, /HttpOnly/i);
  assert.match(cookies, /SameSite=Lax/i);
});

test("security: SVG и HTML в загрузках отклоняются", async () => {
  for (const dataUrl of [
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:text/html;base64,PGI+SGk8L2I+",
  ]) {
    const res = await request(ctx.base, "POST", "/api/uploads", {
      cookie: userCookie,
      body: { dataUrl },
    });
    assert.equal(res.status, 400, dataUrl);
  }
});
