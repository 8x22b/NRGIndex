/* NRG/INDEX — личный кабинет: вход по ключу, добавление через OpenRouter.
 * Ник и подпись назначает админ в keys.js. Свои банки/оценки — в localStorage. */
(() => {
  const data = window.NRG_DATA;
  const KEYS = window.NRG_KEYS || [];
  const AI = window.NRG_AI || {};
  if (!data) return;

  const LS_KEY = "nrgindex:v2";
  const SESSION_KEY = "nrgindex:session";
  const ACCENTS = [
    ["#ff4f79", "#ff7448"], ["#00b8d9", "#7ee6e1"], ["#8b3bc4", "#ef3ea6"],
    ["#39a844", "#b7e43b"], ["#f1c46c", "#ff7448"], ["#9fb7ff", "#cf8cff"],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const freshStore = () => ({ addedDrinks: [], ratingEdits: {}, orKey: "" });
  const loadStore = () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return freshStore();
      return { ...freshStore(), ...JSON.parse(raw) };
    } catch { return freshStore(); }
  };
  let store = loadStore();
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch { /* фото ужмётся при следующем сохранении */ }
  };

  const getDrink = (id) => data.drinks.find((d) => d.id === id);
  const getPerson = (pid) => data.participants.find((p) => p.id === pid);

  const applyStore = () => {
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
  };

  /* ---------- auth ---------- */
  const sha256 = async (s) => {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  let me = null; // { pid, name, role, ...person }

  const tryLogin = async (rawKey) => {
    const key = (rawKey || "").trim().toUpperCase();
    if (!key) return null;
    const hash = await sha256(key);
    const rec = KEYS.find((k) => k.hash === hash);
    if (!rec) return null;
    const person = getPerson(rec.pid) || {};
    return { key, pid: rec.pid, name: rec.name || person.name || "Участник", role: rec.role || person.role || "", person };
  };

  const showCabinet = () => {
    $("auth-view").hidden = true;
    $("cab-view").hidden = false;
    const p = me.person || {};
    $("me-avatar").textContent = p.initials || "?";
    $("me-avatar").style.setProperty("--person-color", p.color || "#fff");
    $("me-name").textContent = me.name;
    $("me-role").textContent = me.role;
    renderMine();
  };

  /* ---------- ratings ---------- */
  const setRating = (drinkId, pid, patch) => {
    const drink = getDrink(drinkId);
    if (!drink) return;
    drink.ratings = drink.ratings || {};
    if (patch) drink.ratings[pid] = { tier: patch.tier, review: patch.review || "" };
    else delete drink.ratings[pid];

    if (drink.userAdded) {
      const saved = store.addedDrinks.find((d) => d.id === drinkId);
      if (saved) saved.ratings = structuredClone(drink.ratings);
    } else {
      store.ratingEdits[drinkId] = store.ratingEdits[drinkId] || {};
      store.ratingEdits[drinkId][pid] = patch ? { tier: patch.tier, review: patch.review || "" } : null;
      if (!patch && !Object.values(store.ratingEdits[drinkId]).some(Boolean)) delete store.ratingEdits[drinkId];
    }
    persist();
    renderMine();
  };

  const deleteDrink = (drinkId) => {
    const i = data.drinks.findIndex((d) => d.id === drinkId);
    if (i >= 0) data.drinks.splice(i, 1);
    store.addedDrinks = store.addedDrinks.filter((d) => d.id !== drinkId);
    delete store.ratingEdits[drinkId];
    persist();
    renderMine();
  };

  const renderMine = () => {
    const pid = me.pid;
    const mine = data.drinks.filter((d) => d.ratings?.[pid]);
    $("me-count").textContent = mine.length;
    if (!mine.length) {
      $("cabinet-my-ratings").innerHTML = `<p class="hint">Пока пусто — опиши первую банку выше.</p>`;
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
          <button class="btn btn--ghost" type="button" data-m-del-rating>− оценка</button>
          ${d.userAdded && d.addedBy === pid ? `<button class="btn btn--danger" type="button" data-m-del-drink>× банка</button>` : ""}
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

  /* ---------- images: load, shrink, cut white bg ---------- */
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
      if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < TOL) return true;
      return Math.min(r, g, b) > BRIGHT_MIN && Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX;
    };

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
    if (bgShare < 0.005) return { dataUrl: null, cut: false };

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

  const processImageUrl = async (url) => {
    const img = await loadImage(url);
    const cut = cutWhiteBg(img);
    return { dataUrl: cut.dataUrl || shrinkOnly(img), auto: true };
  };

  const searchImages = async (query) => {
    const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
      `&generator=search&gsrsearch=${encodeURIComponent(query + " energy drink can")}` +
      "&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url%7Csize&iiurlwidth=480";
    const res = await (await fetch(url)).json();
    return Object.values(res?.query?.pages || {})
      .map((p) => p?.imageinfo?.[0]?.thumburl || p?.imageinfo?.[0]?.url)
      .filter(Boolean);
  };

  /* ---------- OpenRouter: разбор банки ---------- */
  const orKey = () => store.orKey || AI.key || "";
  const TIER_RE = /^[SABCD]$/;

  const parseWithAI = async (freeText) => {
    const key = orKey();
    if (!AI.endpoint || !AI.model) throw new Error("не задан endpoint/модель (keys.js)");
    if (!key) throw new Error("нет OpenRouter-ключа — попроси его у админа");
    const res = await fetch(AI.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": location.origin,
        "X-Title": "NRG/INDEX",
      },
      body: JSON.stringify({
        model: AI.model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "Ты разбираешь сообщение про энергетик и возвращаешь СТРОГО JSON без пояснений: " +
              '{"brand":"бренд","name":"полное название","flavor":"вкус по-русски","edition":"издание/дизайн банки, коротко","tier":"S|A|B|C|D","review":"живой отзыв 1-3 предложения по-русски"} ' +
              "tier выведи из описания: восторг=S, хвалят=A, норм=B, так себе=C, ругают=D. Если чего-то нет в тексте — додумай правдоподобно по названию, пустым не оставляй.",
          },
          { role: "user", content: freeText },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const json = await res.json();
    const raw = (json?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    if (!parsed.name) throw new Error("ИИ вернул пустоту, попробуй переформулировать");
    if (!TIER_RE.test(parsed.tier)) parsed.tier = "B";
    for (const f of ["brand", "name", "flavor", "edition", "review"]) parsed[f] = String(parsed[f] || "").trim();
    if (!parsed.brand) parsed.brand = parsed.name;
    return parsed;
  };

  /* ---------- smart flow ---------- */
  const pending = { parsed: null, image: null, photoNote: "", searchResults: [], searchIndex: 0, userPhoto: false };
  const slug = (s) => (s || "").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "drink";

  const fillManual = (p) => {
    if (!p) return;
    $("m-brand").value = p.brand || "";
    $("m-name").value = p.name || "";
    $("m-flavor").value = p.flavor || "";
    $("m-edition").value = p.edition || "";
    $("m-tier").value = TIER_RE.test(p.tier) ? p.tier : "B";
    $("m-review").value = p.review || "";
  };

  const showPreview = () => {
    const p = pending.parsed;
    if (!p) return;
    $("smart-preview").hidden = false;
    if (pending.image) $("parsed-img").src = pending.image;
    $("parsed-title").textContent = `${p.brand} — ${p.name}`;
    $("parsed-sub").textContent = [p.flavor, p.edition].filter(Boolean).join(" · ");
    $("parsed-review").textContent = p.review || "—";
    $("parsed-tier").textContent = p.tier;
    $("parsed-photo-note").textContent = pending.photoNote;
    fillManual(p);
    $("smart-preview").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const autoPhoto = async (parsed) => {
    if (pending.userPhoto) return; // своё фото важнее автопоиска
    const status = $("smart-status");
    try {
      const results = await searchImages(`${parsed.brand} ${parsed.name}`);
      pending.searchResults = results;
      pending.searchIndex = 0;
      if (!results.length) {
        pending.image = null;
        pending.photoNote = "фото не нашлось — приложи своё или выбери вручную ниже";
      } else {
        try {
          const done = await processImageUrl(results[0]);
          pending.image = done.dataUrl;
          pending.photoNote = "фото найдено автоматически ✓";
        } catch {
          pending.image = results[0];
          pending.photoNote = "фото найдено автоматически ✓ (без обработки)";
        }
      }
    } catch {
      pending.photoNote = "поиск фото не ответил — приложи своё или выбери вручную ниже";
    }
    status.textContent = "";
    showPreview();
  };

  const retryPhoto = async () => {
    const list = pending.searchResults;
    if (!list.length) {
      $("smart-status").textContent = "Вариантов больше нет — вставь ссылку вручную ниже.";
      return;
    }
    pending.searchIndex = (pending.searchIndex + 1) % list.length;
    $("smart-status").textContent = `Фото ${pending.searchIndex + 1} / ${list.length}…`;
    try {
      const done = await processImageUrl(list[pending.searchIndex]);
      pending.image = done.dataUrl;
      pending.photoNote = `фото найдено автоматически ✓ (${pending.searchIndex + 1}/${list.length})`;
    } catch {
      pending.image = list[pending.searchIndex];
      pending.photoNote = `фото ${pending.searchIndex + 1}/${list.length} (без обработки)`;
    }
    $("smart-status").textContent = "";
    showPreview();
  };

  const buildDrink = (p, image) => ({
    id: `${slug(p.brand)}-${slug(p.flavor || p.name)}-u${Date.now().toString(36)}`,
    brand: p.brand, name: p.name, flavor: p.flavor,
    edition: p.edition || "кастомная банка",
    image: image || "assets/favicon.svg",
    sourceLabel: `добавил ${me.name}`,
    accent: ACCENTS[data.drinks.length % ACCENTS.length],
    related: [],
    ratings: { [me.pid]: { tier: p.tier, review: p.review || "" } },
    userAdded: true, addedBy: me.pid,
  });

  const saveDrink = (drink) => {
    data.drinks.push(structuredClone(drink));
    store.addedDrinks.push(structuredClone(drink));
    persist();
    pending.parsed = null; pending.image = null; pending.userPhoto = false;
    pending.searchResults = []; pending.searchIndex = 0;
    $("smart-preview").hidden = true;
    $("smart-input").value = "";
    $("voice-audio").hidden = true;
    $("smart-status").textContent = "В индексе ✓";
    renderMine();
  };

  const submitSmart = async (e) => {
    e.preventDefault();
    const text = $("smart-input").value.trim();
    if (!text) { $("smart-status").textContent = "Напиши хоть пару слов или надиктуй войсом."; return; }
    $("smart-status").textContent = "Нейросеть разбирает…";
    try {
      pending.parsed = await parseWithAI(text);
      pending.userPhoto = !!pending.image; // фото могли приложить заранее
      $("smart-status").textContent = "Ищу фото…";
      await autoPhoto(pending.parsed);
    } catch (err) {
      $("smart-status").textContent = "ИИ не ответил: " + (err?.message || err) + ". Заполни вручную ниже.";
    }
  };

  const submitManual = () => {
    const p = {
      brand: $("m-brand").value.trim(), name: $("m-name").value.trim(),
      flavor: $("m-flavor").value.trim(), edition: $("m-edition").value.trim(),
      tier: $("m-tier").value, review: $("m-review").value.trim(),
    };
    if (!p.brand || !p.name || !p.flavor) { $("smart-status").textContent = "Вручную нужны хотя бы бренд, название и вкус."; return; }
    saveDrink(buildDrink(p, pending.image));
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
      btn.textContent = "● Войс вместо текста";
      const blob = new Blob(voice.chunks, { type: voice.recorder.mimeType || "audio/webm" });
      if (blob.size) {
        const audio = $("voice-audio");
        audio.src = URL.createObjectURL(blob);
        audio.hidden = false;
      }
      status.textContent = srSupported() ? "Готово." : "Записано. Диктовка тут не поддерживается — вбей текст руками.";
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
          const area = $("smart-input");
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

  /* ---------- export / import / wipe ---------- */
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: "nrgindex", v: 2, addedDrinks: store.addedDrinks, ratingEdits: store.ratingEdits }, null, 2)], { type: "application/json" });
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
      for (const d of store.addedDrinks) {
        const i = data.drinks.findIndex((x) => x.id === d.id);
        if (i >= 0) data.drinks.splice(i, 1);
      }
      for (const [drinkId, perPid] of Object.entries(store.ratingEdits)) {
        const drink = getDrink(drinkId);
        if (drink?.ratings) for (const pid of Object.keys(perPid)) delete drink.ratings[pid];
      }
      store.addedDrinks = json.addedDrinks || [];
      store.ratingEdits = json.ratingEdits || {};
      persist();
      applyStore();
      renderMine();
      $("sync-status").textContent = "Импорт влит ✓";
    } catch { $("sync-status").textContent = "Не смог прочитать файл."; }
  };

  /* ---------- wire up ---------- */
  applyStore();

  const doLogin = async () => {
    $("auth-status").textContent = "Проверяю…";
    const found = await tryLogin($("auth-key").value);
    if (!found) { $("auth-status").textContent = "Такого ключа нет. Проверь буквы или спроси у админа."; return; }
    me = found;
    try { sessionStorage.setItem(SESSION_KEY, found.key); } catch {}
    showCabinet();
  };

  $("btn-login").onclick = doLogin;
  $("auth-key").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("btn-logout").onclick = () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    location.reload();
  };

  $("smart-form").addEventListener("submit", submitSmart);
  $("btn-confirm").onclick = () => { if (pending.parsed) saveDrink(buildDrink(pending.parsed, pending.image)); };
  $("btn-retry-photo").onclick = retryPhoto;
  $("btn-record").onclick = toggleRecord;

  $("smart-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $("smart-status").textContent = "Режу фон…";
    try {
      const img = await loadImage(URL.createObjectURL(file));
      const cut = cutWhiteBg(img);
      pending.image = cut.dataUrl || shrinkOnly(img);
      pending.userPhoto = true;
      pending.photoNote = cut.dataUrl ? "твоё фото · фон вырезан ✓" : "твоё фото ✓";
      $("smart-status").textContent = "Фото приложено ✓";
      if (pending.parsed) showPreview();
    } catch { $("smart-status").textContent = "Не смог прочитать файл."; }
  });

  // ручной fallback: правит pending-объект наживую
  for (const [id, field] of [["m-brand", "brand"], ["m-name", "name"], ["m-flavor", "flavor"], ["m-edition", "edition"], ["m-tier", "tier"], ["m-review", "review"]]) {
    $(id).addEventListener("input", (e) => { if (pending.parsed) pending.parsed[field] = e.target.value; });
  }
  // кнопка ручного сохранения — добавим в details через статус
  $("btn-manual-pick").onclick = async () => {
    const url = pending.manualResults?.[pending.manualIndex];
    if (!url) return;
    try {
      const done = await processImageUrl(url);
      pending.image = done.dataUrl;
    } catch { pending.image = url; }
    pending.photoNote = "фото выбрано вручную ✓";
    if (pending.parsed) showPreview();
    else $("smart-status").textContent = "Фото выбрано ✓ теперь нажми «Распознать» или заполни поля и жми кнопку ниже.";
  };

  const manualAddBtn = document.createElement("button");
  manualAddBtn.className = "btn btn--big";
  manualAddBtn.type = "button";
  manualAddBtn.textContent = "Добавить вручную из этих полей";
  manualAddBtn.onclick = submitManual;
  $("btn-manual-pick").closest("details").appendChild(manualAddBtn);

  // ручной поиск фото (fallback)
  pending.manualResults = [];
  pending.manualIndex = 0;
  const showManual = () => {
    const list = pending.manualResults;
    if (!list.length) return;
    pending.manualIndex = (pending.manualIndex + list.length) % list.length;
    $("m-img").src = list[pending.manualIndex];
    $("m-count").textContent = `${pending.manualIndex + 1} / ${list.length}`;
  };
  $("btn-manual-search").onclick = async () => {
    const q = $("m-image-search").value.trim();
    if (!q) return;
    $("m-count").textContent = "ищу…";
    $("manual-results").hidden = false;
    try {
      pending.manualResults = await searchImages(q);
      pending.manualIndex = 0;
      if (!pending.manualResults.length) { $("m-count").textContent = "ничего не нашлось"; $("m-img").removeAttribute("src"); return; }
      showManual();
    } catch { $("m-count").textContent = "поиск не ответил"; }
  };
  $("m-image-search").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("btn-manual-search").click(); } });
  $("m-prev").onclick = () => { pending.manualIndex--; showManual(); };
  $("m-next").onclick = () => { pending.manualIndex++; showManual(); };
  $("btn-manual-url").onclick = async () => {
    const url = $("m-image-url").value.trim();
    if (!url) return;
    try {
      const done = await processImageUrl(url);
      pending.image = done.dataUrl;
    } catch { pending.image = url; }
    pending.photoNote = "фото по ссылке ✓";
    if (pending.parsed) showPreview();
    else $("smart-status").textContent = "Фото взято ✓";
  };

  $("btn-or-save").onclick = () => {
    store.orKey = $("or-key").value.trim();
    persist();
    $("or-key").value = "";
    $("sync-status").textContent = store.orKey ? "Свой ключ сохранён локально ✓" : "Свой ключ убран, используется общий ✓";
  };
  $("btn-export").onclick = exportJson;
  $("import-file").addEventListener("change", (e) => importJson(e.target.files[0]));
  $("btn-wipe").onclick = () => {
    if (confirm("Стереть ВСЕ локальные данные этого кабинета в браузере?")) {
      localStorage.removeItem(LS_KEY);
      location.reload();
    }
  };

  // автовход по сессии
  (async () => {
    let saved = null;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch {}
    if (saved) {
      const found = await tryLogin(saved);
      if (found) { me = found; showCabinet(); }
    }
  })();
})();
