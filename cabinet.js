/* NRG/INDEX — личные кабинеты.
 * Всё хранится в localStorage этого браузера, доска пересчитывается мгновенно.
 * Ключ ИИ — только локально, в репозиторий не попадает. */
(() => {
  const data = window.NRG_DATA;
  if (!data) return;

  const LS_KEY = "nrgindex:v1";
  const ACCENTS = [
    ["#ff4f79", "#ff7448"], ["#00b8d9", "#7ee6e1"], ["#8b3bc4", "#ef3ea6"],
    ["#39a844", "#b7e43b"], ["#f1c46c", "#ff7448"], ["#9fb7ff", "#cf8cff"],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const loadStore = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return freshStore();
      return { ...freshStore(), ...JSON.parse(raw) };
    } catch { return freshStore(); }
  };
  const freshStore = () => ({ profiles: {}, addedDrinks: [], ratingEdits: {}, ai: {}, activePid: null });
  let store = loadStore();
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* переполнено — фото ужмётся при следующем сохранении */ }
  };

  const getDrink = (id) => data.drinks.find((d) => d.id === id);
  const today = () => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  };

  /* ---------- merge local data into base ---------- */
  const applyStore = () => {
    for (const p of data.participants) {
      const o = store.profiles[p.id];
      if (o) { if (o.name) p.name = o.name; if (o.role) p.role = o.role; if (o.initials) p.initials = o.initials; }
    }
    for (const d of store.addedDrinks) {
      if (!getDrink(d.id)) data.drinks.push(structuredClone(d));
    }
    for (const [drinkId, perPid] of Object.entries(store.ratingEdits)) {
      const drink = getDrink(drinkId);
      if (!drink) continue;
      drink.ratings = drink.ratings || {};
      for (const [pid, r] of Object.entries(perPid)) {
        if (r) drink.ratings[pid] = { ...r };
        else delete drink.ratings[pid];
      }
    }
    if (!data.participants.some((p) => p.id === store.activePid)) {
      store.activePid = data.participants[0]?.id || null;
    }
  };

  const notify = () => {
    data.updatedAt = today();
    document.dispatchEvent(new Event("nrg:data-changed"));
    renderAll();
  };

  /* ---------- ratings (base + user drinks) ---------- */
  const setRating = (drinkId, pid, patch) => {
    const drink = getDrink(drinkId);
    if (!drink) return;
    drink.ratings = drink.ratings || {};
    if (patch) drink.ratings[pid] = { tier: patch.tier, review: patch.review || "" };
    else delete drink.ratings[pid];

    if (drink.userAdded) {
      const saved = store.addedDrinks.find((d) => d.id === drinkId);
      if (saved) { saved.ratings = structuredClone(drink.ratings); }
    } else {
      store.ratingEdits[drinkId] = store.ratingEdits[drinkId] || {};
      store.ratingEdits[drinkId][pid] = patch ? { tier: patch.tier, review: patch.review || "" } : null;
      if (!patch && !Object.values(store.ratingEdits[drinkId]).some(Boolean)) delete store.ratingEdits[drinkId];
    }
    persist();
    notify();
  };

  const deleteDrink = (drinkId) => {
    const i = data.drinks.findIndex((d) => d.id === drinkId);
    if (i >= 0) data.drinks.splice(i, 1);
    store.addedDrinks = store.addedDrinks.filter((d) => d.id !== drinkId);
    delete store.ratingEdits[drinkId];
    persist();
    notify();
  };

  /* ---------- image: load, shrink, cut white bg ---------- */
  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const cutWhiteBg = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    const px = id.data;

    // медиана границы = образец фона
    const border = [];
    for (let x = 0; x < w; x += 2) { border.push(x * 4, ((h - 1) * w + x) * 4); }
    for (let y = 0; y < h; y += 2) { border.push((y * w) * 4, (y * w + w - 1) * 4); }
    const ch = [[], [], []];
    for (const o of border) { ch[0].push(px[o]); ch[1].push(px[o + 1]); ch[2].push(px[o + 2]); }
    const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const bg = [med(ch[0]), med(ch[1]), med(ch[2])];

    const TOL = 52, BRIGHT_MIN = 120, NEUTRAL_MAX = 34;
    const isBgish = (o) => {
      const r = px[o], g = px[o + 1], b = px[o + 2];
      const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      if (dist < TOL) return true;
      return Math.min(r, g, b) > BRIGHT_MIN && Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX;
    };

    // flood fill от границы (4-связность)
    const mask = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => { const i = y * w + x; if (!mask[i] && isBgish(i * 4)) { mask[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0) { const j = i - 1; if (!mask[j] && isBgish(j * 4)) { mask[j] = 1; stack.push(j); } }
      if (x < w - 1) { const j = i + 1; if (!mask[j] && isBgish(j * 4)) { mask[j] = 1; stack.push(j); } }
      if (y > 0) { const j = i - w; if (!mask[j] && isBgish(j * 4)) { mask[j] = 1; stack.push(j); } }
      if (y < h - 1) { const j = i + w; if (!mask[j] && isBgish(j * 4)) { mask[j] = 1; stack.push(j); } }
    }

    let bgShare = 0;
    for (let i = 0; i < mask.length; i++) bgShare += mask[i];
    bgShare /= mask.length;
    if (bgShare < 0.005) return { dataUrl: null, cut: false }; // фона у края нет — оставляем как есть

    // лёгкое расширение маски (съесть белый ореол) + применение альфы
    const grown = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      if ((x > 0 && mask[y * w + x - 1]) || (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) || (y < h - 1 && mask[(y + 1) * w + x])) grown[y * w + x] = 1;
    }
    for (let i = 0; i < grown.length; i++) if (grown[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(id, 0, 0);
    return { dataUrl: cv.toDataURL("image/png"), cut: true };
  };

  const shrinkOnly = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * scale));
    cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    return cv.toDataURL("image/jpeg", 0.85);
  };

  const state = { pendingImage: null, searchResults: [], searchIndex: 0 };

  const setPendingImage = (dataUrl, label) => {
    state.pendingImage = dataUrl ? { dataUrl, label } : null;
    $("image-preview").hidden = !dataUrl;
    if (dataUrl) {
      $("image-preview-img").src = dataUrl;
      $("image-source-label").textContent = label;
    }
    $("form-status").textContent = "";
  };

  const takeFile = async (file) => {
    if (!file) return;
    $("form-status").textContent = "Режу фон…";
    try {
      const img = await loadImage(URL.createObjectURL(file));
      const cut = cutWhiteBg(img);
      setPendingImage(cut.dataUrl || shrinkOnly(img), cut.dataUrl ? "фото · фон вырезан" : "фото · фон не найден, как есть");
      $("form-status").textContent = cut.dataUrl ? "Фон вырезан ✓" : "Белый фон у края не найден — взял как есть.";
    } catch { $("form-status").textContent = "Не смог прочитать файл."; }
  };

  const takeUrl = async (url, label = "по ссылке") => {
    url = (url || "").trim();
    if (!url) return;
    $("form-status").textContent = "Тяну картинку…";
    try {
      const img = await loadImage(url);
      const cut = cutWhiteBg(img);
      setPendingImage(cut.dataUrl || shrinkOnly(img), `${label}${cut.dataUrl ? " · фон вырезан" : ""}`);
      $("form-status").textContent = cut.dataUrl ? "Фон вырезан ✓" : "Взял как есть (фон у края не найден).";
    } catch {
      // CORS чужого хостинга — кладём ссылку как есть
      setPendingImage(url, `${label} · без обработки (CORS)`);
      $("form-status").textContent = "Хостинг не отдал пиксели (CORS) — вставил ссылку как есть.";
    }
  };

  /* ---------- image search (Wikimedia Commons, без ключей) ---------- */
  const searchImages = async (query) => {
    query = (query || "").trim();
    if (!query) return;
    const box = $("image-results");
    $("img-count").textContent = "ищу…";
    box.hidden = false;
    try {
      const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
        `&generator=search&gsrsearch=${encodeURIComponent(query + " energy drink can")}` +
        "&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=480";
      const res = await (await fetch(url)).json();
      const pages = Object.values(res?.query?.pages || {});
      state.searchResults = pages
        .map((p) => p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url)
        .filter(Boolean);
      state.searchIndex = 0;
      if (!state.searchResults.length) { $("img-count").textContent = "ничего не нашлось"; $("img-img").removeAttribute("src"); return; }
      showSearchResult();
    } catch { $("img-count").textContent = "поиск не ответил"; }
  };

  const showSearchResult = () => {
    const list = state.searchResults;
    if (!list.length) return;
    state.searchIndex = (state.searchIndex + list.length) % list.length;
    $("img-img").src = list[state.searchIndex];
    $("img-count").textContent = `${state.searchIndex + 1} / ${list.length}`;
  };

  /* ---------- voice ---------- */
  const voice = { recorder: null, chunks: [], recording: false, recognizer: null };
  const srSupported = () => window.SpeechRecognition || window.webkitSpeechRecognition;

  const toggleRecord = async () => {
    const btn = $("btn-record"), status = $("voice-status");
    if (voice.recording) { voice.recorder?.stop(); voice.recognizer?.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { status.textContent = "Нет доступа к микрофону."; return; }

    voice.chunks = [];
    voice.recorder = new MediaRecorder(stream);
    voice.recorder.ondataavailable = (e) => { if (e.data.size) voice.chunks.push(e.data); };
    voice.recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      voice.recording = false;
      btn.textContent = "● Записать войс";
      const blob = new Blob(voice.chunks, { type: voice.recorder.mimeType || "audio/webm" });
      if (blob.size) {
        const audio = $("voice-audio");
        audio.src = URL.createObjectURL(blob);
        audio.hidden = false;
      }
      status.textContent = srSupported() ? "Готово." : "Записано. Диктовка в этом браузере не поддерживается — вбей текст руками.";
    };
    voice.recorder.start();
    voice.recording = true;
    btn.textContent = "■ Стоп";
    status.textContent = "Слушаю…";

    if (srSupported()) {
      try {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        voice.recognizer = new SR();
        voice.recognizer.lang = "ru-RU";
        voice.recognizer.interimResults = true;
        voice.recognizer.onresult = (e) => {
          let text = "";
          for (const r of e.results) text += r[0].transcript;
          const area = $("f-review");
          if (e.results[e.results.length - 1].isFinal) {
            area.value = (area.value ? area.value.replace(/\s+$/, "") + " " : "") + text.trim();
          }
          status.textContent = "… " + text.slice(-60);
        };
        voice.recognizer.onend = () => { if (voice.recording) { try { voice.recognizer.start(); } catch {} } };
        voice.recognizer.start();
      } catch { status.textContent = "Запись идёт, диктовка не завелась."; }
    }
  };

  /* ---------- AI rewrite via custom endpoint ---------- */
  const aiRewrite = async () => {
    const area = $("f-review"), status = $("form-status");
    const text = area.value.trim();
    if (!text) { status.textContent = "Сначала надиктуй или вбей текст отзыва."; return; }
    const { endpoint, model, key } = store.ai || {};
    if (!endpoint || !model) { status.textContent = "Задай endpoint и модель в «Настройках ИИ» внизу."; $("ai-settings").open = true; return; }
    status.textContent = "Нейросеть причёсывает…";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          model,
          temperature: 0.7,
          messages: [
            { role: "system", content: "Ты редактор дегустационных заметок про энергетики. Перепиши текст пользователя живо и по-русски, 1–3 предложения. Сохрани смысл, оценки и детали вкуса, мат оставь только если он к месту. Верни ТОЛЬКО переписанный текст без кавычек и комментариев." },
            { role: "user", content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const out = json?.choices?.[0]?.message?.content?.trim();
      if (!out) throw new Error("пустой ответ");
      area.value = out;
      status.textContent = "Готово ✦";
    } catch (e) { status.textContent = "ИИ не ответил: " + (e?.message || e); }
  };

  /* ---------- rendering ---------- */
  const activePid = () => store.activePid;
  const activePerson = () => data.participants.find((p) => p.id === activePid());

  const wordForm = (v, f) => {
    const n = Math.abs(v) % 100, n1 = n % 10;
    if (n > 10 && n < 20) return f[2];
    if (n1 > 1 && n1 < 5) return f[1];
    if (n1 === 1) return f[0];
    return f[2];
  };

  const renderTabs = () => {
    $("cabinet-tabs").innerHTML = data.participants.map((p, i) => `
      <button class="cab-tab ${p.id === activePid() ? "is-active" : ""}" type="button" data-pid="${p.id}" role="tab">
        <span class="cab-tab__avatar" style="--person-color:${p.color}">${esc(p.initials || String(i + 1).padStart(2, "0"))}</span>
        <span><b>${esc(p.name)}</b><small>${esc(p.role || "")}</small></span>
      </button>`).join("");
  };

  const renderProfile = () => {
    const p = activePerson();
    if (!p) { $("cabinet-profile").innerHTML = ""; return; }
    const count = data.drinks.filter((d) => d.ratings?.[p.id]).length;
    $("cabinet-profile").innerHTML = `
      <div class="cab-profile__avatar" style="--person-color:${p.color}">${esc(p.initials)}</div>
      <div class="cab-profile__fields">
        <label>Имя<input id="p-name" type="text" value="${esc(p.name)}" maxlength="24"></label>
        <label>Подпись<input id="p-role" type="text" value="${esc(p.role || "")}" maxlength="40" placeholder="участник"></label>
      </div>
      <div class="cab-profile__meta"><b>${count}</b><span>${wordForm(count, ["оценка", "оценки", "оценок"])}</span></div>
      <button class="btn btn--ghost" type="button" id="btn-profile-save">Сохранить профиль</button>`;
    $("btn-profile-save").onclick = () => {
      const name = $("p-name").value.trim(), role = $("p-role").value.trim();
      if (!name) return;
      p.name = name; p.role = role;
      store.profiles[p.id] = { name, role, initials: p.initials };
      persist(); notify();
    };
  };

  const renderMine = () => {
    const pid = activePid();
    const mine = data.drinks.filter((d) => d.ratings?.[pid]);
    if (!mine.length) {
      $("cabinet-my-ratings").innerHTML = `<p class="hint">Пока пусто — добавь первый энергос через форму.</p>`;
      return;
    }
    $("cabinet-my-ratings").innerHTML = mine.map((d) => {
      const r = d.ratings[pid];
      return `
      <div class="mine-row" data-drink="${d.id}">
        <img src="${esc(d.image)}" alt="" loading="lazy">
        <div class="mine-row__main">
          <b>${esc(d.name)}</b><small>${esc(d.flavor)}</small>
          <textarea rows="2" data-m-review placeholder="Отзыв…">${esc(r.review || "")}</textarea>
        </div>
        <div class="mine-row__actions">
          <select data-m-tier>${["S", "A", "B", "C", "D"].map((t) => `<option ${t === r.tier ? "selected" : ""}>${t}</option>`).join("")}</select>
          <button class="btn btn--ghost" type="button" data-m-del-rating title="Убрать мою оценку">− оценка</button>
          ${d.userAdded && d.addedBy === pid ? `<button class="btn btn--danger" type="button" data-m-del-drink title="Удалить карточку целиком">× банка</button>` : ""}
        </div>
      </div>`;
    }).join("");

    $("cabinet-my-ratings").querySelectorAll(".mine-row").forEach((row) => {
      const drinkId = row.dataset.drink;
      const drink = getDrink(drinkId);
      row.querySelector("[data-m-tier]").onchange = (e) => {
        setRating(drinkId, pid, { tier: e.target.value, review: drink.ratings[pid]?.review || "" });
      };
      row.querySelector("[data-m-review]").onchange = (e) => {
        setRating(drinkId, pid, { tier: drink.ratings[pid]?.tier || "B", review: e.target.value });
      };
      row.querySelector("[data-m-del-rating]").onclick = () => setRating(drinkId, pid, null);
      row.querySelector("[data-m-del-drink]")?.addEventListener("click", () => {
        if (confirm(`Удалить «${drink.name} — ${drink.flavor}» из индекса целиком?`)) deleteDrink(drinkId);
      });
    });
  };

  const renderPeople = () => {
    const n = data.participants.length;
    const hp = $("header-people");
    if (hp) hp.textContent = `${n} ${wordForm(n, ["участник", "участника", "участников"])}`;
    const hero = $("hero-people");
    if (hero) {
      const words = { 1: "Один человек.", 2: "Два человека.", 3: "Три человека.", 4: "Четыре человека.", 5: "Пять человек." };
      hero.textContent = `${words[n] || `${n} человек.`} Один общий рейтинг. Никакой объективности — только вкус, настроение и последствия.`;
    }
  };

  const renderAi = () => {
    $("ai-endpoint").value = store.ai?.endpoint || "";
    $("ai-model").value = store.ai?.model || "";
    if (store.ai?.key) $("ai-key").placeholder = "ключ сохранён •••• (введи новый чтобы заменить)";
  };

  const renderAll = () => { renderTabs(); renderProfile(); renderMine(); renderPeople(); };

  /* ---------- add drink ---------- */
  const slug = (s) => (s || "").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "drink";

  const submitDrink = (e) => {
    e.preventDefault();
    const pid = activePid();
    const brand = $("f-brand").value.trim(), name = $("f-name").value.trim(), flavor = $("f-flavor").value.trim();
    if (!brand || !name || !flavor) { $("form-status").textContent = "Заполни бренд, название и вкус."; return; }
    const img = state.pendingImage;
    const drink = {
      id: `${slug(brand)}-${slug(flavor)}-u${Date.now().toString(36)}`,
      brand, name, flavor,
      edition: $("f-edition").value.trim() || "кастомная банка",
      image: img?.dataUrl || "assets/favicon.svg",
      sourceLabel: img ? `добавил ${activePerson()?.name || "участник"}` : "без фото",
      accent: ACCENTS[data.drinks.length % ACCENTS.length],
      related: [],
      ratings: { [pid]: { tier: $("f-tier").value, review: $("f-review").value.trim() } },
      userAdded: true, addedBy: pid,
    };
    data.drinks.push(structuredClone(drink));
    store.addedDrinks.push(structuredClone(drink));
    persist();
    e.target.reset();
    $("f-tier").value = "A";
    setPendingImage(null);
    $("voice-audio").hidden = true;
    $("image-results").hidden = true;
    $("form-status").textContent = "В индексе ✓ доска обновилась.";
    notify();
  };

  /* ---------- export / import / wipe ---------- */
  const exportJson = () => {
    const { endpoint, model } = store.ai || {};
    const blob = new Blob([JSON.stringify({ app: "nrgindex", v: 1, profiles: store.profiles, addedDrinks: store.addedDrinks, ratingEdits: store.ratingEdits, ai: { endpoint, model } }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nrgindex-data.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importJson = async (file) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.app !== "nrgindex") throw new Error("не наш JSON");
      // сносим ранее влитые локальные банки, чтобы не дублировать
      for (const d of store.addedDrinks) {
        const i = data.drinks.findIndex((x) => x.id === d.id);
        if (i >= 0) data.drinks.splice(i, 1);
      }
      // откатываем правки оценок базовых банок
      for (const [drinkId, perPid] of Object.entries(store.ratingEdits)) {
        const drink = getDrink(drinkId);
        if (drink?.ratings) for (const pid of Object.keys(perPid)) delete drink.ratings[pid];
      }
      store.profiles = json.profiles || {};
      store.addedDrinks = json.addedDrinks || [];
      store.ratingEdits = json.ratingEdits || {};
      if (json.ai) store.ai = { ...store.ai, endpoint: json.ai.endpoint || "", model: json.ai.model || "" };
      persist();
      applyStoreFull();
      notify();
      $("form-status").textContent = "Импорт влит ✓";
    } catch { $("form-status").textContent = "Не смог прочитать файл."; }
  };

  const applyStoreFull = () => {
    // полный ре-аплай после импорта: профили + банки + оценки
    applyStore();
  };

  /* ---------- wire up ---------- */
  applyStore();

  document.addEventListener("click", (e) => {
    const tab = e.target.closest("#cabinet-tabs [data-pid]");
    if (tab) { store.activePid = tab.dataset.pid; persist(); renderAll(); }
  });

  $("drink-form").addEventListener("submit", submitDrink);
  $("f-image-file").addEventListener("change", (e) => takeFile(e.target.files[0]));
  $("btn-image-url").onclick = () => takeUrl($("f-image-url").value);
  $("btn-image-search").onclick = () => searchImages($("f-image-search").value);
  $("f-image-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchImages(e.target.value); } });
  $("img-prev").onclick = () => { state.searchIndex--; showSearchResult(); };
  $("img-next").onclick = () => { state.searchIndex++; showSearchResult(); };
  $("btn-image-pick").onclick = () => takeUrl(state.searchResults[state.searchIndex], "из поиска");
  $("btn-image-clear").onclick = () => setPendingImage(null);
  $("btn-record").onclick = toggleRecord;
  $("btn-ai-rewrite").onclick = aiRewrite;
  $("btn-ai-save").onclick = () => {
    store.ai = {
      endpoint: $("ai-endpoint").value.trim(),
      model: $("ai-model").value.trim(),
      key: $("ai-key").value || store.ai?.key || "",
    };
    persist();
    $("ai-key").value = "";
    $("ai-status").textContent = "Сохранено локально ✓";
    renderAi();
  };
  $("btn-export").onclick = exportJson;
  $("import-file").addEventListener("change", (e) => importJson(e.target.files[0]));
  $("btn-wipe").onclick = () => {
    if (confirm("Стереть ВСЕ локальные данные кабинетов в этом браузере?")) {
      localStorage.removeItem(LS_KEY);
      location.reload();
    }
  };

  renderAll();
  renderAi();
})();
