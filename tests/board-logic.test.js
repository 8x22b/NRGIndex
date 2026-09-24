// Поведенческие тесты доски: поиск, фильтр тиров, диплинк /d/:slug.
// public/app.js исполняется в vm с минимальными DOM-заглушками.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

function makeSummary() {
  return {
    site: { title: "NRG / INDEX", description: "тест" },
    updatedAt: "01.01.2026",
    tiers: [
      { id: "S", title: "Supreme", note: "", score: 5 },
      { id: "A", title: "Excellent", note: "", score: 4 },
      { id: "B", title: "Good", note: "", score: 3 },
    ],
    participants: [{ id: "sanya", name: "Саня", initials: "СЯ", role: "", color: "#ff0000" }],
    drinks: [
      {
        id: "burn-original",
        brand: "Burn",
        name: "Burn Original",
        flavor: "оригинал",
        edition: "",
        image: "assets/burn-original.png",
        accent: ["#ff4f79", "#ff7448"],
        ratings: { sanya: { tier: "S", review: "" } },
        related: [],
      },
      {
        id: "volt-mango",
        brand: "Volt",
        name: "Volt Mango",
        flavor: "манго-лайм",
        edition: "",
        image: "assets/volt-mango-lime.png",
        accent: ["#ff4f79", "#ff7448"],
        ratings: { sanya: { tier: "A", review: "" } },
        related: [],
      },
    ],
  };
}

function element() {
  return {
    innerHTML: "",
    textContent: "",
    dataset: {},
    value: "",
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {} },
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    scrollIntoView() {},
    showModal() {},
    close() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    open: false,
    animate() {},
  };
}

async function runApp({ summary, pathname = "/", search = "" }) {
  const handlers = {};
  const byId = { "board-search": element(), "board-filters": element() };
  byId["board-search"].addEventListener = (type, fn) => {
    handlers[type] = fn;
  };
  byId["board-filters"].addEventListener = (type, fn) => {
    handlers[`filters:${type}`] = fn;
  };
  const board = element();
  const dialog = element();
  let modalOpened = false;
  dialog.showModal = () => {
    modalOpened = true;
  };
  const urls = [];
  const sandbox = {
    document: {
      querySelector: (sel) => {
        if (sel === "#tier-board") return board;
        if (sel === "#drink-dialog") return dialog;
        if (sel === ".cursor-aura") return null;
        if (sel === ".brand__name") return null;
        if (sel === ".marquee__track") return null;
        if (sel === 'meta[name="description"]') return null;
        return element();
      },
      querySelectorAll: (sel) => {
        if (sel === "[data-tier-filter]") return [];
        return [];
      },
      getElementById: (id) => byId[id] || null,
      addEventListener: () => {},
      body: { classList: { add() {}, remove() {} } },
    },
    window: {
      clearTimeout: clearTimeout,
      setTimeout: setTimeout,
      addEventListener: () => {},
      matchMedia: () => ({ matches: true }),
    },
    location: { pathname, search, hash: "", origin: "http://localhost" },
    history: { replaceState: (_, __, url) => urls.push(url) },
    navigator: {},
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    URLSearchParams,
    encodeURIComponent,
    fetch: async () => ({ ok: true, json: async () => summary }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP, sandbox, { filename: "app.js" });
  // ждём fetch + debounce renderBoard (170мс)
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { board, handlers, urls, modalOpened, searchEl: byId["board-search"] };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("поиск оставляет только подходящие банки", async () => {
  const { board, handlers, searchEl } = await runApp({ summary: makeSummary() });
  assert.match(board.innerHTML, /Burn Original/);
  assert.match(board.innerHTML, /Volt Mango/);

  searchEl.value = "манго";
  handlers.input();
  await sleep(300);
  assert.doesNotMatch(board.innerHTML, /Burn Original/);
  assert.match(board.innerHTML, /Volt Mango/);

  searchEl.value = "";
  handlers.input();
  await sleep(300);
  assert.match(board.innerHTML, /Burn Original/);
  assert.match(board.innerHTML, /Volt Mango/);
});

test("фильтр тира показывает только свой тир", async () => {
  const { board, handlers } = await runApp({ summary: makeSummary() });
  const chip = element();
  chip.dataset.tierFilter = "S";
  handlers["filters:click"]({ target: { closest: () => chip } });
  await sleep(300);
  assert.match(board.innerHTML, /Burn Original/);
  assert.doesNotMatch(board.innerHTML, /Volt Mango/);
  assert.match(board.innerHTML, /ничего не найдено|пока пусто/);
});

test("диплинк /d/:slug открывает диалог", async () => {
  const { modalOpened, urls } = await runApp({ summary: makeSummary(), pathname: "/d/volt-mango" });
  assert.equal(modalOpened, true);
  assert.ok(urls[urls.length - 1].endsWith("/d/volt-mango"));
});
