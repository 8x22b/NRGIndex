const readline = require("node:readline");
const config = require("../server/config");
const { openDatabase } = require("../server/db");
const { hashPassword } = require("../server/auth");
const { username: validateUsername, password: validatePassword, oneOf } = require("../server/lib/validate");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", (line) => {
        rl.close();
        resolve(line.trim());
      });
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function readAllStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

async function readPassword(args) {
  if (args.password) return validatePassword(args.password);
  if (!process.stdin.isTTY) {
    const lines = (await readAllStdin()).split(/\r?\n/);
    const first = lines[0] || "";
    const second = lines[1] === undefined ? first : lines[1];
    if (first !== second) throw new Error("Пароли не совпадают");
    return validatePassword(first);
  }
  const first = await promptHidden("Пароль: ");
  const second = await promptHidden("Повторите пароль: ");
  if (first !== second) throw new Error("Пароли не совпадают");
  return validatePassword(first);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const login = validateUsername(args.username || "");
  const role = oneOf(args.role || "admin", ["admin", "editor", "user"], "role");
  const displayName = String(args.name || login).trim();
  const title = String(args.title || "").trim();
  const pass = await readPassword(args);

  const db = openDatabase(config.dbPath);
  const hash = await hashPassword(pass);
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(login);
  if (existing) {
    db.prepare(
      `UPDATE users SET display_name = ?, role = ?, title = ?, password_hash = ?,
         must_change_password = 0, is_active = 1, updated_at = datetime('now') WHERE id = ?`,
    ).run(displayName, role, title, hash, existing.id);
    console.log(`Обновлён пользователь ${login} (роль ${role})`);
  } else {
    db.prepare(
      `INSERT INTO users (username, display_name, role, title, password_hash, must_change_password)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(login, displayName, role, title, hash);
    console.log(`Создан пользователь ${login} (роль ${role})`);
  }
  console.log(`База: ${config.dbPath}`);
  db.close();
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  console.error(
    "Использование: node scripts/create-admin.js --username admin --name \"Имя\" [--role admin] [--password ...]",
  );
  process.exit(1);
});
