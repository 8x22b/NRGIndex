(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  const safeColor = (value, fallback) =>
    /^#[0-9a-fA-F]{6}$/.test(String(value || "")) ? value : fallback;
  const wordForm = (value, forms) => {
    const n = Math.abs(value) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  };

  const api = async (method, path, body) => {
    const res = await fetch(path, {
      method,
      headers: {
        "x-nrg-request": "1",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  };

  const state = { me: null, summary: null, addedSlugs: new Set() };
  const pending = {
    parsed: null,
    image: null,
    photoNote: "",
    searchResults: [],
    searchIndex: 0,
    userPhoto: false,
    manualResults: [],
    manualIndex: 0,
  };

  /* ---------- views ---------- */
  const showAuth = () => {
    $("auth-view").hidden = false;
    $("password-view").hidden = true;
    $("cab-view").hidden = true;
  };
  const showPasswordChange = () => {
    $("auth-view").hidden = true;
    $("password-view").hidden = false;
    $("cab-view").hidden = true;
  };

  const enterCabinet = async () => {
    $("auth-view").hidden = true;
    $("password-view").hidden = true;
    $("cab-view").hidden = false;
    $("me-avatar").textContent =
      state.me.initials || String(state.me.displayName || "?").slice(0, 2).toUpperCase();
    $("me-avatar").style.setProperty("--person-color", safeColor(state.me.color, "#fff"));
    $("me-name").textContent = state.me.displayName;
    $("me-role").textContent = state.me.title || state.me.role;
    if (state.me.role === "admin") $("admin-button").hidden = false;
    if (state.me.role === "admin" || state.me.role === "editor") $("admin-link").hidden = false;
    await refreshAll();
  };

  const refreshAll = async () => {
    const [summary, mine] = await Promise.all([
      api("GET", "api/public/summary"),
      api("GET", "api/cabinet/me"),
    ]);
    state.summary = summary;
    state.addedSlugs = new Set((mine.addedDrinks || []).map((drink) => drink.slug));
    if (summary.site?.title) document.title = `${summary.site.title} — личный кабинет`;
    renderMine();
  };

  /* ---------- auth ---------- */
  const login = async () => {
    $("auth-status").textContent = "Проверяю…";
    try {
      const { user } = await api("POST", "api/auth/login", {
        username: $("auth-user").value.trim(),
        password: $("auth-pass").value,
      });
      state.me = user;
      $("auth-pass").value = "";
      $("auth-status").textContent = "";
      if (user.mustChangePassword) showPasswordChange();
      else await enterCabinet();
    } catch (error) {
      $("auth-status").textContent = error.message;
    }
  };

  $("btn-login").onclick = login;
  $("auth-user").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  $("auth-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  $("btn-set-pass").onclick = async () => {
    const first = $("new-pass").value;
    const second = $("new-pass2").value;
    if (first !== second) {
      $("pass-status").textContent = "Пароли не совпадают";
      return;
    }
    try {
      await api("POST", "api/auth/password", { newPassword: first });
      state.me.mustChangePassword = false;
      $("new-pass").value = "";
      $("new-pass2").value = "";
      $("pass-status").textContent = "";
      await enterCabinet();
    } catch (error) {
      $("pass-status").textContent = error.message;
    }
  };

  $("btn-change-pass").onclick = async () => {
    try {
      await api("POST", "api/auth/password", {
        currentPassword: $("old-pass").value,
        newPassword: $("change-pass").value,
      });
      $("old-pass").value = "";
      $("change-pass").value = "";
      $("sync-status").textContent = "Пароль обновлён ✓";
    } catch (error) {
      $("sync-status").textContent = error.message;
    }
  };

  $("btn-logout").onclick = async () => {
    try {
      await api("POST", "api/auth/logout");
    } catch {
      /* всё равно перезагружаемся */
    }
    location.reload();
  };

  /* ---------- my ratings ---------- */
  const saveRating = async (slug, tier, review) => {
    const drink = state.summary.drinks.find((item) => item.id === slug);
    const current = drink?.ratings?.[state.me.username] || {};
    try {
      await api("PUT", `api/cabinet/ratings/${encodeURIComponent(slug)}`, {
        tier: tier || current.tier || "B",
        review: review !== null && review !== undefined ? review : current.review || "",
      });
      await refreshAll();
    } catch (error) {
      alert(error.message);
    }
  };

  const renderMine = () => {
    const container = $("cabinet-my-ratings");
    const mine = state.summary.drinks.filter((drink) => drink.ratings?.[state.me.username]);
    $("me-count").textContent = mine.length;
    $("me-count-label").textContent = wordForm(mine.length, ["оценка", "оценки", "оценок"]);
    if (!mine.length) {
      container.innerHTML = `<p class="hint">Пока пусто — опиши первую банку выше.</p>`;
      return;
    }
    container.innerHTML = mine
      .map((drink) => {
        const rating = drink.ratings[state.me.username];
        const own = state.addedSlugs.has(drink.id);
        return `
        <div class="mine-row" data-drink="${esc(drink.id)}">
          <img src="${esc(drink.image)}" alt="" loading="lazy">
          <div class="mine-row__main">
            <b>${esc(drink.name)}</b><small>${esc(drink.flavor)}</small>
            <textarea rows="2" data-m-review placeholder="Отзыв…">${esc(rating.review || "")}</textarea>
          </div>
          <div class="mine-row__actions">
            <select data-m-tier>${state.summary.tiers
              .map((tier) => `<option ${tier.id === rating.tier ? "selected" : ""}>${esc(tier.id)}</option>`)
              .join("")}</select>
            <button class="btn btn--ghost" type="button" data-m-del-rating>− оценка</button>
            ${own ? `<button class="btn btn--danger" type="button" data-m-del-drink>× банка</button>` : ""}
          </div>
        </div>`;
      })
      .join("");

    container.querySelectorAll(".mine-row").forEach((row) => {
      const slug = row.dataset.drink;
      row.querySelector("[data-m-tier]").onchange = (e) => saveRating(slug, e.target.value, null);
      row.querySelector("[data-m-review]").onchange = (e) => saveRating(slug, null, e.target.value);
      row.querySelector("[data-m-del-rating]").onclick = async () => {
        try {
          await api("DELETE", `api/cabinet/ratings/${encodeURIComponent(slug)}`);
          await refreshAll();
        } catch (error) {
          alert(error.message);
        }
      };
      row.querySelector("[data-m-del-drink]")?.addEventListener("click", async () => {
        if (!confirm("Удалить банку из индекса целиком?")) return;
        try {
          await api("DELETE", `api/cabinet/drinks/${encodeURIComponent(slug)}`);
          await refreshAll();
        } catch (error) {
          alert(error.message);
        }
      });
    });
  };

  /* ---------- images ---------- */
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
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
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const px = imageData.data;

    const border = [];
    for (let x = 0; x < w; x += 2) border.push(x * 4, ((h - 1) * w + x) * 4);
    for (let y = 0; y < h; y += 2) border.push(y * w * 4, (y * w + w - 1) * 4);
    const channels = [[], [], []];
    for (const offset of border) {
      channels[0].push(px[offset]);
      channels[1].push(px[offset + 1]);
      channels[2].push(px[offset + 2]);
    }
    const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
    const bg = [median(channels[0]), median(channels[1]), median(channels[2])];

    const TOL = 52;
    const BRIGHT_MIN = 120;
    const NEUTRAL_MAX = 34;
    const isBgish = (offset) => {
      const r = px[offset];
      const g = px[offset + 1];
      const b = px[offset + 2];
      if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < TOL) return true;
      return (
        Math.min(r, g, b) > BRIGHT_MIN && Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX
      );
    };

    const mask = new Uint8Array(w * h);
    const stack = [];
    const seed = (x, y) => {
      const i = y * w + x;
      if (!mask[i] && isBgish(i * 4)) {
        mask[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      seed(x, 0);
      seed(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      seed(0, y);
      seed(w - 1, y);
    }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && !mask[i - 1] && isBgish((i - 1) * 4)) {
        mask[i - 1] = 1;
        stack.push(i - 1);
      }
      if (x < w - 1 && !mask[i + 1] && isBgish((i + 1) * 4)) {
        mask[i + 1] = 1;
        stack.push(i + 1);
      }
      if (y > 0 && !mask[i - w] && isBgish((i - w) * 4)) {
        mask[i - w] = 1;
        stack.push(i - w);
      }
      if (y < h - 1 && !mask[i + w] && isBgish((i + w) * 4)) {
        mask[i + w] = 1;
        stack.push(i + w);
      }
    }

    let bgShare = 0;
    for (let i = 0; i < mask.length; i++) bgShare += mask[i];
    bgShare /= mask.length;
    if (bgShare < 0.005) return null;

    const grown = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) continue;
        if (
          (x > 0 && mask[y * w + x - 1]) ||
          (x < w - 1 && mask[y * w + x + 1]) ||
          (y > 0 && mask[(y - 1) * w + x]) ||
          (y < h - 1 && mask[(y + 1) * w + x])
        ) {
          grown[y * w + x] = 1;
        }
      }
    }
    for (let i = 0; i < grown.length; i++) if (grown[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  };

  const shrinkOnly = (img, maxSide = 640) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const processImageUrl = async (url) => {
    const img = await loadImage(url);
    return cutWhiteBg(img) || shrinkOnly(img);
  };

  /* ---------- smart flow ---------- */
  const TIERS = ["S", "A", "B", "C", "D"];

  const fillManual = (parsed) => {
    if (!parsed) return;
    $("m-brand").value = parsed.brand || "";
    $("m-name").value = parsed.name || "";
    $("m-flavor").value = parsed.flavor || "";
    $("m-edition").value = parsed.edition || "";
    $("m-tier").value = TIERS.includes(parsed.tier) ? parsed.tier : "B";
    $("m-review").value = parsed.review || "";
  };

  const showPreview = () => {
    const parsed = pending.parsed;
    if (!parsed) return;
    $("smart-preview").hidden = false;
    const img = $("parsed-img");
    if (pending.image) {
      img.src = pending.image;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
    $("parsed-title").textContent = `${parsed.brand} — ${parsed.name}`;
    $("parsed-sub").textContent = [parsed.flavor, parsed.edition].filter(Boolean).join(" · ");
    $("parsed-review").textContent = parsed.review || "—";
    $("parsed-tier").textContent = parsed.tier;
    $("parsed-photo-note").textContent = pending.photoNote;
    fillManual(parsed);
    $("smart-preview").scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const autoPhoto = async (parsed) => {
    if (pending.userPhoto) {
      showPreview();
      return;
    }
    try {
      const { images } = await api(
        "GET",
        `api/cabinet/ai/photo-search?q=${encodeURIComponent(`${parsed.brand} ${parsed.name}`)}`,
      );
      pending.searchResults = images || [];
      pending.searchIndex = 0;
      if (!pending.searchResults.length) {
        pending.image = null;
        pending.photoNote = "фото не нашлось — приложи своё или выбери вручную ниже";
      } else {
        try {
          pending.image = await processImageUrl(pending.searchResults[0]);
          pending.photoNote = "фото найдено автоматически ✓";
        } catch {
          pending.image = null;
          pending.photoNote = "фото нашлось, но не обработалось — приложи своё";
        }
      }
    } catch {
      pending.photoNote = "поиск фото не ответил — приложи своё или выбери вручную ниже";
    }
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
      pending.image = await processImageUrl(list[pending.searchIndex]);
      pending.photoNote = `фото найдено автоматически ✓ (${pending.searchIndex + 1}/${list.length})`;
    } catch {
      pending.image = null;
      pending.photoNote = `фото ${pending.searchIndex + 1}/${list.length} не обработалось`;
    }
    $("smart-status").textContent = "";
    showPreview();
  };

  const saveDrink = async (parsed) => {
    const body = {
      brand: parsed.brand,
      name: parsed.name,
      flavor: parsed.flavor,
      edition: parsed.edition,
      tier: TIERS.includes(parsed.tier) ? parsed.tier : "B",
      review: parsed.review || "",
    };
    if (pending.image && pending.image.startsWith("data:")) body.imageDataUrl = pending.image;
    await api("POST", "api/cabinet/drinks", body);
    pending.parsed = null;
    pending.image = null;
    pending.userPhoto = false;
    pending.searchResults = [];
    pending.searchIndex = 0;
    $("smart-preview").hidden = true;
    $("smart-input").value = "";
    $("voice-audio").hidden = true;
    $("smart-status").textContent = "В индексе ✓";
    await refreshAll();
  };

  const submitSmart = async (event) => {
    event.preventDefault();
    const text = $("smart-input").value.trim();
    if (!text) {
      $("smart-status").textContent = "Напиши хоть пару слов или надиктуй войсом.";
      return;
    }
    $("smart-status").textContent = "Нейросеть разбирает…";
    try {
      const { parsed } = await api("POST", "api/cabinet/ai/parse", { text });
      pending.parsed = parsed;
      pending.userPhoto = Boolean(pending.image);
      $("smart-status").textContent = "Ищу фото…";
      await autoPhoto(parsed);
      $("smart-status").textContent = "";
    } catch (error) {
      $("smart-status").textContent = `${error.message}. Заполни вручную ниже.`;
    }
  };

  const submitManual = async () => {
    const parsed = {
      brand: $("m-brand").value.trim(),
      name: $("m-name").value.trim(),
      flavor: $("m-flavor").value.trim(),
      edition: $("m-edition").value.trim(),
      tier: $("m-tier").value,
      review: $("m-review").value.trim(),
    };
    if (!parsed.brand || !parsed.name || !parsed.flavor) {
      $("smart-status").textContent = "Вручную нужны хотя бы бренд, название и вкус.";
      return;
    }
    try {
      await saveDrink(parsed);
    } catch (error) {
      $("smart-status").textContent = error.message;
    }
  };

  $("smart-form").addEventListener("submit", submitSmart);
  $("btn-confirm").onclick = async () => {
    if (!pending.parsed) return;
    try {
      await saveDrink(pending.parsed);
    } catch (error) {
      $("smart-status").textContent = error.message;
    }
  };
  $("btn-retry-photo").onclick = retryPhoto;
  $("btn-manual-save").onclick = submitManual;

  for (const [id, field] of [
    ["m-brand", "brand"],
    ["m-name", "name"],
    ["m-flavor", "flavor"],
    ["m-edition", "edition"],
    ["m-tier", "tier"],
    ["m-review", "review"],
  ]) {
    $(id).addEventListener("input", (event) => {
      if (pending.parsed) pending.parsed[field] = event.target.value;
    });
  }

  $("smart-photo").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $("smart-status").textContent = "Режу фон…";
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await loadImage(objectUrl);
      const cut = cutWhiteBg(img);
      pending.image = cut || shrinkOnly(img);
      pending.userPhoto = true;
      pending.photoNote = cut ? "твоё фото · фон вырезан ✓" : "твоё фото ✓";
      $("smart-status").textContent = "Фото приложено ✓";
      if (pending.parsed) showPreview();
    } catch {
      $("smart-status").textContent = "Не смог прочитать файл.";
    } finally {
      URL.revokeObjectURL(objectUrl);
      event.target.value = "";
    }
  });

  const showManual = () => {
    const list = pending.manualResults;
    if (!list.length) return;
    pending.manualIndex = (pending.manualIndex + list.length) % list.length;
    $("m-img").src = list[pending.manualIndex];
    $("m-count").textContent = `${pending.manualIndex + 1} / ${list.length}`;
  };

  $("btn-manual-search").onclick = async () => {
    const query = $("m-image-search").value.trim();
    if (!query) return;
    $("m-count").textContent = "ищу…";
    $("manual-results").hidden = false;
    try {
      const { images } = await api(
        "GET",
        `api/cabinet/ai/photo-search?q=${encodeURIComponent(query)}`,
      );
      pending.manualResults = images || [];
      pending.manualIndex = 0;
      if (!pending.manualResults.length) {
        $("m-count").textContent = "ничего не нашлось";
        $("m-img").removeAttribute("src");
        return;
      }
      showManual();
    } catch (error) {
      $("m-count").textContent = error.message;
    }
  };

  $("m-image-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("btn-manual-search").click();
    }
  });
  $("m-prev").onclick = () => {
    pending.manualIndex--;
    showManual();
  };
  $("m-next").onclick = () => {
    pending.manualIndex++;
    showManual();
  };

  $("btn-manual-pick").onclick = async () => {
    const url = pending.manualResults[pending.manualIndex];
    if (!url) return;
    try {
      pending.image = await processImageUrl(url);
      pending.photoNote = "фото выбрано вручную ✓";
    } catch {
      pending.image = null;
      pending.photoNote = "не удалось скачать фото из поиска";
    }
    if (pending.parsed) showPreview();
    else $("smart-status").textContent = "Фото выбрано ✓";
  };

  $("btn-manual-url").onclick = async () => {
    const url = $("m-image-url").value.trim();
    if (!url) return;
    try {
      pending.image = await processImageUrl(url);
      pending.photoNote = "фото по ссылке ✓";
    } catch {
      pending.image = null;
      pending.photoNote = "не удалось загрузить фото по ссылке";
    }
    if (pending.parsed) showPreview();
    else $("smart-status").textContent = pending.image ? "Фото взято ✓" : pending.photoNote;
  };

  /* ---------- voice ---------- */
  const voice = { recorder: null, chunks: [], recording: false, recognizer: null };
  const srSupported = () => window.SpeechRecognition || window.webkitSpeechRecognition;

  const toggleRecord = async () => {
    const button = $("btn-record");
    const status = $("voice-status");
    if (voice.recording) {
      voice.recording = false;
      voice.recorder?.stop();
      voice.recognizer?.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = "Нет доступа к микрофону.";
      return;
    }

    voice.chunks = [];
    voice.recorder = new MediaRecorder(stream);
    voice.recorder.ondataavailable = (event) => {
      if (event.data.size) voice.chunks.push(event.data);
    };
    voice.recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(voice.chunks, { type: voice.recorder.mimeType || "audio/webm" });
      if (blob.size) {
        const audio = $("voice-audio");
        audio.src = URL.createObjectURL(blob);
        audio.hidden = false;
      }
      status.textContent = srSupported()
        ? "Готово."
        : "Записано. Диктовка тут не поддерживается — вбей текст руками.";
    };
    voice.recorder.start();
    voice.recording = true;
    button.textContent = "■ Стоп";
    status.textContent = "Слушаю…";

    if (srSupported()) {
      try {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        voice.recognizer = new Recognition();
        voice.recognizer.lang = "ru-RU";
        voice.recognizer.interimResults = true;
        voice.recognizer.onresult = (event) => {
          let finalText = "";
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
          }
          if (finalText) {
            const area = $("smart-input");
            area.value = (area.value ? area.value.replace(/\s+$/, "") + " " : "") + finalText.trim();
          }
          const last = event.results[event.results.length - 1];
          status.textContent = last?.isFinal ? "…" : `… ${String(last?.[0]?.transcript || "").slice(-60)}`;
        };
        voice.recognizer.onend = () => {
          if (voice.recording) {
            try {
              voice.recognizer.start();
            } catch {
              /* уже остановлен */
            }
          } else {
            const buttonNode = $("btn-record");
            if (buttonNode) buttonNode.textContent = "● Войс вместо текста";
          }
        };
        voice.recognizer.start();
      } catch {
        status.textContent = "Запись идёт, диктовка не завелась.";
      }
    }
  };

  $("btn-record").onclick = toggleRecord;

  /* ---------- init ---------- */
  (async () => {
    try {
      const { user } = await api("GET", "api/auth/me");
      state.me = user;
    } catch {
      state.me = null;
    }
    if (!state.me) return showAuth();
    if (state.me.mustChangePassword) return showPasswordChange();
    return enterCabinet();
  })();
})();
