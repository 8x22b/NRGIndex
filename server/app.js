const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const { createAuth } = require("./auth");
const { ApiError } = require("./lib/errors");
const pkg = require("../package.json");

function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-nrg-request") !== "1") {
    return next(new ApiError(403, "Запрос отклонён (CSRF)", "csrf"));
  }
  const origin = req.get("origin");
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return next(new ApiError(403, "Некорректный origin", "csrf"));
    }
    if (host !== req.get("host")) return next(new ApiError(403, "Запрос с чужого origin", "csrf"));
  }
  return next();
}

function createApp({ db, config }) {
  const auth = createAuth(db, config);
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy && config.trustProxy !== "false") {
    app.set("trust proxy", config.trustProxy === "true" ? true : config.trustProxy);
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://upload.wikimedia.org",
            "https://thumb.wikimedia.org",
            "https://commons.wikimedia.org",
            "https://images.openfoodfacts.org",
          ],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      hsts: false,
      crossOriginEmbedderPolicy: false,
      xFrameOptions: { action: "deny" },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: config.jsonLimit }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    req.user = auth.userFromRequest(req);
    next();
  });
  app.use("/api", csrfGuard);

  app.get("/api/health", (req, res) => res.json({ ok: true, version: pkg.version }));

  app.use("/api/public", require("./routes/public")(db));
  app.use("/api/auth", require("./routes/auth")(db, auth));
  app.use("/api/cabinet", auth.requireAuth, require("./routes/cabinet")(db, auth, config));
  app.use("/api/uploads", auth.requireAuth, require("./routes/uploads")(db, auth, config));
  app.use(
    "/api/admin",
    auth.requireRole("editor", "admin"),
    require("./routes/admin")(db, auth, config),
  );

  const staffOnly = (req, res, next) => {
    if (!req.user || !["admin", "editor"].includes(req.user.role)) return res.redirect("/");
    next();
  };
  app.get("/admin", staffOnly, (req, res) => {
    res.sendFile(path.join(config.root, "admin", "index.html"));
  });
  app.get("/admin.js", staffOnly, (req, res) => {
    res.sendFile(path.join(config.root, "admin", "admin.js"));
  });

  app.use(
    express.static(config.publicDir, {
      extensions: ["html"],
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=2592000");
        } else if (filePath.includes(`${path.sep}fonts${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (/\.(css|js)$/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=600");
        }
      },
    }),
  );

  app.use(
    "/uploads",
    express.static(config.uploadsDir, {
      fallthrough: false,
      immutable: true,
      maxAge: "365d",
      setHeaders(res) {
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    }),
  );

  app.use("/api", (req, res) => res.status(404).json({ error: "Не найдено" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "Слишком большой запрос" });
    }
    if (err?.status || err?.statusCode) {
      return res.status(err.status || err.statusCode).end();
    }
    console.error("[nrgindex]", err);
    return res.status(500).json({ error: "Внутренняя ошибка" });
  });

  return app;
}

module.exports = { createApp, csrfGuard };
