// Групповой reporter: раскладывает тесты по категориям (папкам), показывает
// по файлу количество пройденных тестов и собирает итоговую сводку.
const path = require("node:path");

const TESTS_DIR = __dirname;
const CATEGORIES = [
  ["unit", "Юниты — логика и библиотеки"],
  ["api", "API — HTTP, данные и интеграция"],
  ["ui", "UI — разметка и клиентский код"],
  ["security", "Безопасность — сканы и защита"],
];
const CATEGORY_TITLES = Object.fromEntries(CATEGORIES);

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text) => paint("32", text);
const red = (text) => paint("31", text);
const dim = (text) => paint("2", text);
const bold = (text) => paint("1", text);

const categoryOf = (file) => {
  const first = path.relative(TESTS_DIR, file || "").split(path.sep)[0];
  return CATEGORY_TITLES[first] ? first : "other";
};

const formatMs = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return ms < 1000 ? `${Math.round(ms)} мс` : `${(ms / 1000).toFixed(1)} с`;
};

module.exports = async function* reporter(source) {
  const files = new Map();
  const order = [];
  let currentFile = null;

  const stateOf = (file) => {
    if (!files.has(file)) {
      files.set(file, { pass: 0, fail: 0, duration: 0, failures: [], output: [] });
      order.push(file);
    }
    return files.get(file);
  };

  for await (const event of source) {
    const { type, data } = event;
    const ms = data?.details?.duration_ms ?? data?.duration_ms ?? 0;
    if (type === "test:pass" || type === "test:fail") {
      const file = data.file || currentFile || "unknown";
      const state = stateOf(file);
      const isFileLevel = /\.test\.js$/i.test(data.name || "");
      if (isFileLevel) {
        state.duration = ms || state.duration;
        if (type === "test:fail") {
          state.fail += 1;
          state.failures.push(data);
        }
      } else if (type === "test:pass") {
        state.pass += 1;
        state.duration += ms;
      } else {
        state.fail += 1;
        state.duration += ms;
        state.failures.push(data);
      }
    } else if (type === "test:stdout" || type === "test:stderr") {
      const file = data.file || currentFile;
      const text = String(data.message || "").trimEnd();
      if (file && text) stateOf(file).output.push(text);
    } else if (type === "test:start") {
      currentFile = data.file || currentFile;
      stateOf(currentFile);
    }
  }

  const totals = { pass: 0, fail: 0, duration: 0 };
  for (const state of files.values()) {
    totals.pass += state.pass;
    totals.fail += state.fail;
    totals.duration += state.duration || 0;
  }

  const lines = ["", bold("  NRG / INDEX — тесты"), ""];
  for (const [key, title] of CATEGORIES) {
    const inCategory = order.filter((file) => categoryOf(file) === key);
    if (!inCategory.length) continue;
    lines.push(dim(`  ${title}`));
    for (const file of inCategory) {
      const state = files.get(file);
      const total = state.pass + state.fail;
      const icon = state.fail ? red("✗") : green("✓");
      const name = path.basename(file).replace(/\.test\.js$/, "");
      const counts = (state.fail ? `${state.pass}/${total}` : `${total}`).padStart(7);
      lines.push(
        `    ${icon} ${name.padEnd(26)} ${state.fail ? red(counts) : counts} ${dim(formatMs(state.duration))}`,
      );
      for (const failure of state.failures) {
        lines.push(`        ${red("✗")} ${failure.name}`);
        const error = failure.details?.error || failure.error || {};
        const cause = error.cause || {};
        let message = String(error.message || "").trim();
        if (!message && cause.code === "ERR_ASSERTION") {
          message = `ожидалось ${JSON.stringify(cause.expected)}, получено ${JSON.stringify(cause.actual)}`;
        }
        if (!message) message = error.failureType || error.code || "тест упал";
        for (const chunk of message.split("\n").slice(0, 4)) {
          lines.push(`          ${dim(chunk.trim())}`);
        }
      }
      for (const output of state.output) {
        for (const chunk of output.split("\n").slice(0, 5)) lines.push(`          ${dim(chunk)}`);
      }
    }
    lines.push("");
  }

  const summary = totals.fail
    ? `${green(`${totals.pass} прошло`)}, ${red(`${totals.fail} упало`)}`
    : green(`${totals.pass} прошло`);
  const parts = [`Итого: ${summary}`, `файлов: ${order.length}`];
  const spent = formatMs(totals.duration);
  if (spent) parts.push(spent);
  lines.push(`  ${parts.join(" · ")}`);
  lines.push("");

  yield `${lines.join("\n")}\n`;
};
