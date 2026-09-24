(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );

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

  const state = { me: null, data: null, tab: "drinks", removeImage: false };
  const remoteImageToDataUrl = async (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Укажите корректную ссылку на картинку");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Ссылка должна начинаться с http:// или https://");
    }
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(`Не удалось загрузить картинку (HTTP ${response.status})`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Ссылка ведёт не на изображение");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Не удалось прочитать картинку"));
      reader.readAsDataURL(blob);
    });
  };
  const status = (id, message, isError = false) => {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "#ff8a8a" : "";
  };

  const loadData = async () => {
    state.data = await api("GET", "api/admin/data");
  };

  const refresh = async () => {
    await loadData();
    render();
  };

  /* ---------- tabs ---------- */
  const switchTab = (tab) => {
    state.tab = tab;
    document.querySelectorAll("#admin-tabs .btn").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === tab);
    });
    for (const name of ["drinks", "tiers", "users", "settings", "audit"]) {
      $(`tab-${name}`).hidden = name !== tab;
    }
    render();
  };

  const render = () => {
    if (state.tab === "drinks") renderDrinks();
    else if (state.tab === "tiers") renderTiers();
    else if (state.tab === "users") renderUsers();
    else if (state.tab === "settings") renderSettings();
    else renderAudit();
  };

  /* ---------- drinks ---------- */
  const renderDrinks = () => {
    const drinks = state.data.drinks;
    $("drinks-table").innerHTML = `
      <table class="admin-table">
        <thead><tr><th></th><th>Название</th><th>Бренд</th><th>Оценки</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${drinks
            .map(
              (drink) => `
            <tr>
              <td>${drink.image ? `<img src="${esc(drink.image)}" alt="">` : "—"}</td>
              <td><b>${esc(drink.name)}</b><br><span class="muted">${esc(drink.flavor)}</span></td>
              <td>${esc(drink.brand)}</td>
              <td>${Object.keys(drink.ratings || {}).length}</td>
              <td><span class="admin-badge ${drink.published ? "admin-badge--on" : "admin-badge--off"}">${drink.published ? "опубликован" : "скрыт"}</span></td>
              <td class="admin-actions">
                <button class="btn btn--ghost" type="button" data-edit="${drink.id}">Править</button>
                <button class="btn btn--ghost" type="button" data-toggle="${drink.id}">${drink.published ? "Скрыть" : "Опубликовать"}</button>
                ${String(drink.image || "").startsWith("/uploads/") ? `<button class="btn btn--ghost" type="button" data-reprocess="${drink.id}">Переобработать</button>` : ""}
                <button class="btn btn--danger" type="button" data-delete="${drink.id}">Удалить</button>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;

    const container = $("drinks-table");
    container.querySelectorAll("[data-edit]").forEach((button) => {
      button.onclick = () => openDrinkForm(Number(button.dataset.edit));
    });
    container.querySelectorAll("[data-toggle]").forEach((button) => {
      button.onclick = async () => {
        const drink = state.data.drinks.find((item) => item.id === Number(button.dataset.toggle));
        if (drink.published) {
          const ok = await window.nrgConfirm({
            title: "Скрыть напиток?",
            message: `«${drink.name}» пропадёт с публичного сайта вместе с оценками. Вернуть можно кнопкой «Опубликовать».`,
            confirmText: "Скрыть",
          });
          if (!ok) return;
        }
        try {
          await api("PATCH", `api/admin/drinks/${drink.id}`, { published: !drink.published });
          await refresh();
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
    container.querySelectorAll("[data-reprocess]").forEach((button) => {
      button.onclick = async () => {
        try {
          status("global-status", "Обрабатываю картинку…");
          await api("POST", `api/admin/drinks/${button.dataset.reprocess}/reprocess-image`, {});
          await refresh();
          status("global-status", "Картинка переобработана, цвет обновлён ✓");
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
    container.querySelectorAll("[data-delete]").forEach((button) => {
      button.onclick = async () => {
        const drink = state.data.drinks.find((item) => item.id === Number(button.dataset.delete));
        const votes = Object.keys(drink.ratings || {}).length;
        const ok = await window.nrgConfirm({
          title: "Удалить напиток?",
          message: `«${drink.name}» будет удалён целиком.`,
          details: [
            votes ? `Вместе с ним удалятся оценки: ${votes}` : "Оценок у напитка нет",
            state.me.role === "admin" ? "Откатить можно в «Журнале»" : "",
          ],
          confirmText: "Удалить напиток",
        });
        if (!ok) return;
        try {
          await api("DELETE", `api/admin/drinks/${drink.id}`);
          await refresh();
          status("global-status", `«${drink.name}» удалён`);
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
  };

  const openDrinkForm = (id) => {
    const drink = id ? state.data.drinks.find((item) => item.id === id) : null;
    $("d-id").value = drink ? drink.id : "";
    $("d-brand").value = drink?.brand || "";
    $("d-name").value = drink?.name || "";
    $("d-flavor").value = drink?.flavor || "";
    $("d-edition").value = drink?.edition || "";
    $("d-source").value = drink?.sourceLabel || "";
    $("d-accent-a").value = drink?.accent?.[0] || "#ff4f79";
    $("d-accent-b").value = drink?.accent?.[1] || "#ff7448";
    $("d-published").checked = drink ? drink.published : true;
    $("d-image-path").value = drink?.image || "";
    const preview = $("d-image-preview");
    if (drink?.image) {
      preview.src = drink.image;
      preview.hidden = false;
    } else {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    resetPhotoStrip();
    $("d-photo-query").value = drink
      ? [drink.brand, drink.name, drink.flavor].filter(Boolean).join(" ")
      : "";
    state.removeImage = false;
    $("d-related").innerHTML = state.data.drinks
      .filter((item) => item.id !== (drink?.id || -1))
      .map(
        (item) =>
          `<option value="${item.id}" ${drink?.related?.includes(item.id) ? "selected" : ""}>${esc(item.name)}</option>`,
      )
      .join("");
    $("drink-form").hidden = false;
    status("drink-status", drink ? `Правка напитка #${drink.id}` : "Новый напиток");
  };

  $("btn-drink-new").onclick = () => openDrinkForm(null);
  $("btn-drink-cancel").onclick = () => {
    $("drink-form").hidden = true;
    $("drink-form").reset();
    resetPhotoStrip();
  };

  $("d-image-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      status("drink-status", "Обрабатываю картинку…");
      const dataUrl = await fileToDataUrl(file, 1200);
      const { path, accent } = await api("POST", "api/uploads", { dataUrl });
      state.removeImage = false;
      $("d-image-path").value = path;
      $("d-accent-a").value = accent[0];
      $("d-accent-b").value = accent[1];
      const preview = $("d-image-preview");
      preview.src = path;
      preview.hidden = false;
      status("drink-status", `Готово: фон вырезан, цвет ${accent[0]} / ${accent[1]}`);
    } catch (error) {
      status("drink-status", error.message || "Не удалось прочитать файл", true);
    } finally {
      event.target.value = "";
    }
  });

  $("btn-drink-image-url").onclick = async () => {
    const value = $("d-image-url").value.trim();
    if (!value) return;
    try {
      status("drink-status", "Загружаю картинку по ссылке…");
      const dataUrl = await remoteImageToDataUrl(value);
      const { path, accent } = await api("POST", "api/uploads", { dataUrl });
      state.removeImage = false;
      $("d-image-path").value = path;
      $("d-accent-a").value = accent[0];
      $("d-accent-b").value = accent[1];
      $("d-image-preview").src = path;
      $("d-image-preview").hidden = false;
      status("drink-status", "Картинка загружена и обработана ✓");
    } catch (error) {
      status("drink-status", error.message, true);
    }
  };

  const resetPhotoStrip = () => {
    $("d-photo-strip").hidden = true;
    $("d-photo-track").innerHTML = "";
    $("d-photo-status").textContent = "";
  };

  const pickDrinkPhoto = async (item, tile) => {
    if (!item?.url) return;
    try {
      status("drink-status", "Загружаю выбранное фото…");
      tile?.classList.add("is-loading");
      const dataUrl = await remoteImageToDataUrl(item.url);
      const { path, accent } = await api("POST", "api/uploads", { dataUrl });
      state.removeImage = false;
      $("d-image-path").value = path;
      $("d-accent-a").value = accent[0];
      $("d-accent-b").value = accent[1];
      $("d-image-preview").src = path;
      $("d-image-preview").hidden = false;
      $("d-photo-track")
        .querySelectorAll(".photo-tile")
        .forEach((node) => node.classList.remove("is-selected", "is-loading"));
      tile?.classList.add("is-selected");
      status("drink-status", `Фото заменено: фон вырезан, цвет ${accent[0]} / ${accent[1]}`);
    } catch (error) {
      tile?.classList.remove("is-loading");
      status("drink-status", error.message, true);
    }
  };

  const searchDrinkPhotos = async () => {
    const typed = $("d-photo-query").value.trim();
    const query =
      typed ||
      [$("d-brand").value, $("d-name").value, $("d-flavor").value]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" ");
    if (query.replace(/\s+/g, "").length < 2) {
      status("drink-status", "Введи хотя бы 2 символа или заполни бренд и название", true);
      return;
    }
    try {
      status("drink-status", "Ищу фото…");
      $("d-photo-strip").hidden = false;
      $("d-photo-track").innerHTML = "";
      $("d-photo-status").textContent = "ищу…";
      const params = new URLSearchParams({ q: query });
      const { images } = await api("GET", `api/cabinet/ai/photo-search?${params}`);
      if (!images?.length) {
        $("d-photo-status").textContent = "ничего не нашлось — уточни запрос";
        return;
      }
      $("d-photo-status").textContent = `${images.length} шт · жми нужное`;
      images.forEach((item) => {
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "photo-tile";
        tile.title = [item.title, item.source].filter(Boolean).join(" · ");
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => tile.remove();
        tile.appendChild(img);
        tile.onclick = () => pickDrinkPhoto(item, tile);
        $("d-photo-track").appendChild(tile);
      });
      status("drink-status", "Выбери фото из ленты — оно сразу загрузится и обработается");
    } catch (error) {
      $("d-photo-status").textContent = "";
      status("drink-status", error.message, true);
    }
  };

  $("btn-drink-photo-search").onclick = searchDrinkPhotos;
  $("d-photo-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchDrinkPhotos();
    }
  });

  $("d-image-path").addEventListener("input", () => {
    const preview = $("d-image-preview");
    const value = $("d-image-path").value.trim();
    if (value) {
      state.removeImage = false;
      preview.src = value;
      preview.hidden = false;
    } else {
      state.removeImage = true;
      preview.hidden = true;
      preview.removeAttribute("src");
    }
  });

  $("btn-drink-image-clear").onclick = () => {
    state.removeImage = true;
    $("d-image-path").value = "";
    $("d-image-preview").hidden = true;
    $("d-image-preview").removeAttribute("src");
    status("drink-status", "Картинка будет убрана при сохранении");
  };

  $("drink-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      brand: $("d-brand").value,
      name: $("d-name").value,
      flavor: $("d-flavor").value,
      edition: $("d-edition").value,
      sourceLabel: $("d-source").value,
      accentA: $("d-accent-a").value,
      accentB: $("d-accent-b").value,
      published: $("d-published").checked,
      relatedIds: [...$("d-related").selectedOptions].map((option) => Number(option.value)),
    };
    const imagePath = $("d-image-path").value.trim();
    if (imagePath) payload.image = imagePath;
    else if (state.removeImage) payload.removeImage = true;
    try {
      const id = $("d-id").value;
      if (id) await api("PATCH", `api/admin/drinks/${id}`, payload);
      else await api("POST", "api/admin/drinks", payload);
      $("drink-form").hidden = true;
      $("drink-form").reset();
      await refresh();
      status("global-status", "Напиток сохранён ✓");
    } catch (error) {
      status("drink-status", error.message, true);
    }
  });

  /* ---------- tiers ---------- */
  const renderTiers = () => {
    const tiers = state.data.tiers;
    $("tiers-table").innerHTML = `
      <table class="admin-table">
        <thead><tr><th>ID</th><th>Название</th><th>Описание</th><th>Балл</th><th>Позиция</th><th></th></tr></thead>
        <tbody>
          ${tiers
            .map(
              (tier) => `
            <tr>
              <td><b>${esc(tier.id)}</b></td>
              <td>${esc(tier.title)}</td>
              <td class="muted">${esc(tier.note)}</td>
              <td>${tier.score}</td>
              <td>${tier.position}</td>
              <td class="admin-actions">
                <button class="btn btn--ghost" type="button" data-edit="${esc(tier.id)}">Править</button>
                <button class="btn btn--danger" type="button" data-delete="${esc(tier.id)}">Удалить</button>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;

    const container = $("tiers-table");
    container.querySelectorAll("[data-edit]").forEach((button) => {
      button.onclick = () => openTierForm(button.dataset.edit);
    });
    container.querySelectorAll("[data-delete]").forEach((button) => {
      button.onclick = async () => {
        const tier = state.data.tiers.find((item) => item.id === button.dataset.delete);
        const ok = await window.nrgConfirm({
          title: `Удалить тир ${tier.id}?`,
          message: `Тир «${tier.title}» исчезнет со всех досок. Если он используется в оценках, сервер не даст удалить.`,
          confirmText: "Удалить тир",
        });
        if (!ok) return;
        try {
          await api("DELETE", `api/admin/tiers/${encodeURIComponent(button.dataset.delete)}`);
          await refresh();
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
  };

  const openTierForm = (id) => {
    const tier = id ? state.data.tiers.find((item) => item.id === id) : null;
    $("t-id-original").value = tier ? tier.id : "";
    $("t-id").value = tier?.id || "";
    $("t-id").disabled = Boolean(tier);
    $("t-title").value = tier?.title || "";
    $("t-note").value = tier?.note || "";
    $("t-score").value = tier?.score ?? 3;
    $("t-position").value = tier?.position ?? 10;
    $("tier-form").hidden = false;
    status("tier-status", tier ? `Правка тира ${tier.id}` : "Новый тир");
  };

  $("btn-tier-new").onclick = () => openTierForm(null);
  $("btn-tier-cancel").onclick = () => {
    $("tier-form").hidden = true;
    $("tier-form").reset();
  };

  $("tier-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      title: $("t-title").value,
      note: $("t-note").value,
      score: Number($("t-score").value),
      position: Number($("t-position").value),
    };
    try {
      const original = $("t-id-original").value;
      if (original) {
        await api("PATCH", `api/admin/tiers/${encodeURIComponent(original)}`, payload);
      } else {
        await api("POST", "api/admin/tiers", { id: $("t-id").value, ...payload });
      }
      $("tier-form").hidden = true;
      $("tier-form").reset();
      await refresh();
      status("global-status", "Тир сохранён ✓");
    } catch (error) {
      status("tier-status", error.message, true);
    }
  });

  /* ---------- users ---------- */
  const roleLabels = { admin: "админ", editor: "редактор", user: "юзер" };

  const renderUsers = () => {
    const users = state.data.users;
    $("users-table").innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Должность</th><th>Пароль</th><th>Статус</th><th>Публичность</th><th></th></tr></thead>
        <tbody>
          ${users
            .map(
              (user) => `
            <tr>
              <td><b>${esc(user.username)}</b></td>
              <td>${esc(user.displayName)}</td>
              <td>${esc(roleLabels[user.role] || user.role)}</td>
              <td class="muted">${esc(user.title)}</td>
              <td>${user.hasPassword ? (user.mustChangePassword ? "временный" : "задан") : "нет"}</td>
              <td><span class="admin-badge ${user.isActive ? "admin-badge--on" : "admin-badge--off"}">${user.isActive ? "активен" : "отключён"}</span></td>
              <td><span class="admin-badge ${user.isPublic ? "admin-badge--on" : "admin-badge--off"}">${user.isPublic ? "на сайте" : "скрыт"}</span></td>
              <td class="admin-actions">
                <a class="btn btn--ghost" href="/profile.html?u=${encodeURIComponent(user.username)}" target="_blank" rel="noopener">Профиль</a>
                <button class="btn btn--ghost" type="button" data-edit="${user.id}">Править</button>
                <button class="btn btn--ghost" type="button" data-reset="${user.id}">Сбросить пароль</button>
                <button class="btn btn--danger" type="button" data-delete="${user.id}">Удалить</button>
              </td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;

    const container = $("users-table");
    container.querySelectorAll("[data-edit]").forEach((button) => {
      button.onclick = () => openUserForm(Number(button.dataset.edit));
    });
    container.querySelectorAll("[data-reset]").forEach((button) => {
      button.onclick = async () => {
        const user = state.data.users.find((item) => item.id === Number(button.dataset.reset));
        const ok = await window.nrgConfirm({
          title: "Сбросить пароль?",
          message: `${user.displayName} (@${user.username}) получит временный пароль.`,
          details: ["Все его сессии завершатся", "Это действие не откатывается"],
          confirmText: "Сбросить",
        });
        if (!ok) return;
        try {
          const { tempPassword } = await api("POST", `api/admin/users/${user.id}/password`, {});
          $("global-status").innerHTML = `Временный пароль для <b>${esc(user.username)}</b>: <span class="admin-temp">${esc(tempPassword)}</span> — передайте и попросите сменить.`;
          await refresh();
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
    container.querySelectorAll("[data-delete]").forEach((button) => {
      button.onclick = async () => {
        const user = state.data.users.find((item) => item.id === Number(button.dataset.delete));
        const ratedCount = state.data.drinks.filter((drink) => drink.ratings?.[user.username]).length;
        const ok = await window.nrgConfirm({
          title: "Удалить пользователя?",
          message: `${user.displayName} (@${user.username}) потеряет доступ, аккаунт будет удалён.`,
          details: [
            ratedCount ? `Вместе с ним удалятся оценки: ${ratedCount}` : "Оценок у него нет",
            "Откатить можно в «Журнале»",
          ],
          confirmText: "Удалить пользователя",
        });
        if (!ok) return;
        try {
          await api("DELETE", `api/admin/users/${user.id}`);
          await refresh();
        } catch (error) {
          status("global-status", error.message, true);
        }
      };
    });
  };

  const openUserForm = (id) => {
    const user = id ? state.data.users.find((item) => item.id === id) : null;
    $("u-id").value = user ? user.id : "";
    $("u-username").value = user?.username || "";
    $("u-name").value = user?.displayName || "";
    $("u-role").value = user?.role || "user";
    $("u-title").value = user?.title || "";
    $("u-initials").value = user?.initials || "";
    $("u-color").value = user?.color || "#9fb7ff";
    $("u-active").checked = user ? user.isActive : true;
    $("u-public").checked = user ? user.isPublic : true;
    $("u-active-row").hidden = !user;
    $("u-password-row").hidden = Boolean(user);
    $("u-password").value = "";
    $("user-form").hidden = false;
    status("user-status", user ? `Правка ${user.username}` : "Новый пользователь");
  };

  $("btn-user-new").onclick = () => openUserForm(null);
  $("btn-user-cancel").onclick = () => {
    $("user-form").hidden = true;
    $("user-form").reset();
  };

  $("user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const id = $("u-id").value;
      if (id) {
        const payload = {
          username: $("u-username").value.trim().toLowerCase(),
          displayName: $("u-name").value,
          role: $("u-role").value,
          title: $("u-title").value,
          initials: $("u-initials").value,
          color: $("u-color").value,
          isActive: $("u-active").checked,
          isPublic: $("u-public").checked,
        };
        const current = state.data.users.find((item) => item.id === Number(id));
        const isSelf = current.id === state.me?.id;
        const warnings = [];
        if (payload.username !== current.username) {
          warnings.push(
            isSelf
              ? `Ваш логин для входа станет «${payload.username}» — старый перестанет работать`
              : `Логин для входа станет «${payload.username}» — сообщите пользователю`,
          );
        }
        if (current.isActive && !payload.isActive) warnings.push("Доступ будет отключён, все сессии завершатся");
        if (current.role === "admin" && payload.role !== "admin") warnings.push("Пользователь потеряет права админа");
        if (current.isPublic && !payload.isPublic) warnings.push("Он и его оценки пропадут с публичного сайта");
        if (warnings.length) {
          const ok = await window.nrgConfirm({
            title: "Сохранить изменения?",
            message: `${current.displayName} (@${current.username}):`,
            details: warnings,
            confirmText: "Сохранить",
          });
          if (!ok) return;
        }
        await api("PATCH", `api/admin/users/${id}`, payload);
        $("user-form").hidden = true;
        await refresh();
        status("global-status", "Пользователь обновлён ✓");
      } else {
        const payload = {
          username: $("u-username").value,
          displayName: $("u-name").value,
          role: $("u-role").value,
          title: $("u-title").value,
          initials: $("u-initials").value,
          color: $("u-color").value,
          isPublic: $("u-public").checked,
          password: $("u-password").value || undefined,
        };
        const { user, tempPassword } = await api("POST", "api/admin/users", payload);
        $("user-form").hidden = true;
        await refresh();
        if (tempPassword) {
          $("global-status").innerHTML = `Создан <b>${esc(user.username)}</b>. Временный пароль: <span class="admin-temp">${esc(tempPassword)}</span> — передайте и попросите сменить.`;
        } else {
          status("global-status", "Пользователь создан ✓");
        }
      }
    } catch (error) {
      status("user-status", error.message, true);
    }
  });

  /* ---------- settings ---------- */
  const renderSettings = () => {
    const settings = state.data.settings;
    $("s-title").value = settings.siteTitle || "";
    $("s-description").value = settings.siteDescription || "";
    $("s-model").value = settings.textModel || settings.openrouterModel || "";
    $("s-stt-model").value = settings.sttModel || "";
    $("s-base-url").value = settings.textBaseUrl || settings.aiBaseUrl || "";
    $("s-model").placeholder = settings.defaults?.textModel || settings.defaults?.openrouterModel || "";
    $("s-stt-model").placeholder = settings.defaults?.sttModel || "";
    $("s-base-url").placeholder = settings.defaults?.textBaseUrl || settings.defaults?.aiBaseUrl || "";
    $("s-key").value = "";
    $("s-key").placeholder = settings.textApiKeySet
      ? "задан — оставьте пустым, чтобы не менять"
      : "не задан";
    $("s-openrouter-key").value = "";
    $("s-openrouter-key").placeholder = settings.openrouterKeySet
      ? "задан — оставьте пустым, чтобы не менять"
      : "не задан";
    // прокси из env в поле не подставляем, иначе при сохранении он «переедет» в БД
    $("s-proxy").value = settings.aiProxyFromEnv ? "" : settings.aiProxyUrl || "";
    if (settings.aiProxyFromEnv) $("s-proxy").placeholder = `из AI_PROXY_URL: ${settings.aiProxyUrl}`;
    $("s-google-key").value = "";
    $("s-google-key").placeholder = settings.googleCseFromEnv
      ? "задан через GOOGLE_CSE_KEY — ввод заменит на значение из БД"
      : settings.googleCseKeySet
        ? "задан — оставьте пустым, чтобы не менять"
        : "не задан";
    // CX не секрет — показываем сохранённый, из env не подставляем
    $("s-google-cx").value = settings.googleCseCx || "";
  };

  $("btn-ai-check").onclick = async () => {
    status("settings-status", "Проверяю связь…");
    try {
      const result = await api("POST", "api/admin/settings/ai-check", {
        aiProxyUrl: $("s-proxy").value.trim(),
      });
      const via = result.viaProxy ? "через прокси" : "напрямую";
      if (result.ok) status("settings-status", `ИИ отвечает ${via} ✓ (${result.ms} мс)`);
      else status("settings-status", `Нет связи ${via}: ${result.error}`, true);
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      siteTitle: $("s-title").value,
      siteDescription: $("s-description").value,
      textModel: $("s-model").value.trim(),
      sttModel: $("s-stt-model").value.trim(),
      textBaseUrl: $("s-base-url").value.trim(),
      aiProxyUrl: $("s-proxy").value.trim(),
      googleCseCx: $("s-google-cx").value.trim(),
    };
    if ($("s-key").value) payload.textApiKey = $("s-key").value;
    if ($("s-openrouter-key").value) payload.openrouterKey = $("s-openrouter-key").value;
    if ($("s-google-key").value) payload.googleCseKey = $("s-google-key").value;
    try {
      await api("PUT", "api/admin/settings", payload);
      await refresh();
      status("settings-status", "Настройки сохранены ✓");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  });

  $("btn-key-clear").onclick = async () => {
    const ok = await window.nrgConfirm({
      title: "Убрать ключ STT?",
      message: "Распознавание голоса перестанет работать, пока не задан новый OpenRouter ключ.",
      details: ["Ключ не сохраняется в журнале — откатить не получится"],
      confirmText: "Убрать ключ",
    });
    if (!ok) return;
    try {
      await api("PUT", "api/admin/settings", { openrouterKey: "" });
      await refresh();
      status("settings-status", "Ключ убран");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  $("btn-text-key-clear").onclick = async () => {
    const ok = await window.nrgConfirm({
      title: "Убрать ключ разбора?",
      message: "Разбор текста перестанет работать, пока не задан новый ключ.",
      confirmText: "Убрать ключ",
    });
    if (!ok) return;
    try {
      await api("PUT", "api/admin/settings", { textApiKey: "" });
      await refresh();
      status("settings-status", "Ключ разбора убран");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  $("btn-photo-check").onclick = async () => {
    status("settings-status", "Проверяю Google CSE… (1 запрос из квоты)");
    try {
      const result = await api("POST", "api/admin/settings/photo-check", {
        googleCseKey: $("s-google-key").value,
        googleCseCx: $("s-google-cx").value.trim(),
      });
      if (result.ok) status("settings-status", `Google CSE отвечает ✓ (${result.ms} мс, фото: ${result.count})`);
      else status("settings-status", `Google CSE не отвечает: ${result.error}`, true);
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  $("btn-google-key-clear").onclick = async () => {
    const ok = await window.nrgConfirm({
      title: "Убрать ключ Google?",
      message: "Поиск фото продолжит работать через Open Food Facts + Wikimedia, но без Google.",
      details: ["Ключ не сохраняется в журнале — откатить не получится"],
      confirmText: "Убрать ключ",
    });
    if (!ok) return;
    try {
      await api("PUT", "api/admin/settings", { googleCseKey: "" });
      await refresh();
      status("settings-status", "Ключ Google убран");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  /* ---------- audit ---------- */
  // Старые записи (до нового формата) не имеют summary — описываем их по коду действия.
  const LEGACY_ACTIONS = {
    "drink.create": "Добавил напиток",
    "drink.update": "Изменил напиток",
    "drink.delete": "Удалил напиток",
    "drink.reprocess": "Переобработал картинку",
    "rating.set": "Поставил оценку",
    "rating.delete": "Удалил оценку",
    "tier.create": "Создал тир",
    "tier.update": "Изменил тир",
    "tier.delete": "Удалил тир",
    "user.create": "Создал пользователя",
    "user.update": "Изменил пользователя",
    "user.password": "Сбросил пароль",
    "user.delete": "Удалил пользователя",
    "settings.update": "Изменил настройки",
    "ai.parse": "Разобрал текст через ИИ",
    "audit.undo": "Откатил действие",
  };
  const ENTITY_NAMES = { drink: "напиток", rating: "оценка", tier: "тир", user: "пользователь", settings: "настройки" };

  const actionKind = (action) => {
    if (action === "audit.undo") return "undo";
    if (/\.(create|set)$/.test(action)) return "create";
    if (/\.delete$/.test(action)) return "delete";
    return "update";
  };
  const KIND_ICONS = { create: "+", delete: "−", update: "✎", undo: "↺" };

  const parseUtc = (value) => new Date(`${String(value).replace(" ", "T")}Z`);
  const dayLabel = (date) => {
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(date, today)) return "Сегодня";
    if (same(date, yesterday)) return "Вчера";
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  };

  const legacySummary = (row) => {
    const base = LEGACY_ACTIONS[row.action.replace(/^admin\./, "")] || row.action;
    const target = row.entityId ? ` ${ENTITY_NAMES[row.entity] || row.entity} ${row.entityId}` : "";
    return `${base}${target}`;
  };

  const legacyDetails = (details) =>
    String(details || "")
      .replace(/\buser=(\d+)/g, (_, id) => {
        const user = state.data.users.find((item) => item.id === Number(id));
        return `пользователь: ${user ? user.displayName : `#${id}`}`;
      })
      .replace(/\btier=/g, "тир: ")
      .replace(/\brole=/g, "роль: ")
      .replace(/\bactive=(true|false)/g, (_, v) => `доступ: ${v === "true" ? "активен" : "отключён"}`)
      .replace(/\bpublic=(true|false)/g, (_, v) => `на сайте: ${v === "true" ? "да" : "нет"}`)
      .replace(/\blogin=/g, "логин: ");

  const auditRowHtml = (row) => {
    const kind = actionKind(row.action);
    const date = parseUtc(row.createdAt);
    const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const summary = row.summary || legacySummary(row);
    const details = (row.summary ? row.details : legacyDetails(row.details))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const tags = [];
    if (row.undoneAt) {
      tags.push(`откачено${row.undoneBy ? ` · ${esc(row.undoneBy)}` : ""} · ${parseUtc(row.undoneAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);
    }
    if (row.undoOf) tags.push(`отмена записи #${row.undoOf}`);
    let action = "";
    if (row.canUndo) action = `<button class="btn btn--ghost" type="button" data-undo="${row.id}">↺ Откатить</button>`;
    else if (row.undoable && !row.undoneAt && !row.undoOf) {
      action = `<span class="admin-hint" title="Объект менялся позже — сначала откатите более свежие записи">позже менялось</span>`;
    }
    return `
      <li class="audit-item ${row.undoneAt ? "is-undone" : ""}">
        <span class="audit-item__time" title="${esc(date.toLocaleString("ru-RU"))} · запись #${row.id}">${esc(time)}</span>
        <span class="audit-item__icon audit-item__icon--${kind}" aria-hidden="true">${KIND_ICONS[kind]}</span>
        <div>
          <div class="audit-item__summary"><span class="audit-item__who">${esc(row.displayName || row.username || "система")}</span> ${esc(summary.charAt(0).toLowerCase() + summary.slice(1))}</div>
          ${details.length ? `<ul class="audit-item__details">${details.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
          ${tags.map((tag) => `<span class="audit-item__tag">${tag}</span>`).join(" ")}
        </div>
        <div>${action}</div>
      </li>`;
  };

  const renderAudit = () => {
    const all = (state.data.audit || []).filter((row) => row.action !== "ai.parse");
    if (!all.length) {
      $("audit-table").innerHTML = `<p class="admin-hint">Журнал пуст или недоступен (нужна роль admin).</p>`;
      return;
    }
    const query = $("audit-search").value.trim().toLowerCase();
    const entity = $("audit-filter").value;
    const rows = all.filter((row) => {
      if (entity && row.entity !== entity) return false;
      if (!query) return true;
      return [row.summary || legacySummary(row), row.details, row.displayName, row.username]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    if (!rows.length) {
      $("audit-table").innerHTML = `<p class="admin-hint">Ничего не нашлось.</p>`;
      return;
    }
    const groups = [];
    for (const row of rows) {
      const label = dayLabel(parseUtc(row.createdAt));
      if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
      groups.at(-1).rows.push(row);
    }
    $("audit-table").innerHTML = groups
      .map(
        (group) => `
        <h3 class="audit-day">${esc(group.label)}</h3>
        <ul class="audit-list">${group.rows.map(auditRowHtml).join("")}</ul>`,
      )
      .join("");

    $("audit-table").querySelectorAll("[data-undo]").forEach((button) => {
      button.onclick = async () => {
        const row = state.data.audit.find((item) => item.id === Number(button.dataset.undo));
        const ok = await window.nrgConfirm({
          title: "Откатить действие?",
          message: `${row.displayName || row.username || "Система"}: ${row.summary}`,
          details: [
            ...String(row.details || "").split("\n").filter(Boolean).slice(0, 6),
            "Объект вернётся в состояние до этого действия",
          ],
          confirmText: "Откатить",
          danger: false,
        });
        if (!ok) return;
        button.disabled = true;
        try {
          const { notes } = await api("POST", `api/admin/audit/${row.id}/undo`, {});
          await refresh();
          status("global-status", `Откачено ✓${notes?.length ? ` (${notes.join("; ")})` : ""}`);
        } catch (error) {
          button.disabled = false;
          status("global-status", error.message, true);
        }
      };
    });
  };

  $("audit-search").addEventListener("input", () => renderAudit());
  $("audit-filter").addEventListener("change", () => renderAudit());

  /* ---------- helpers ---------- */
  const fileToDataUrl = (file, maxSide) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          const isPng = file.type === "image/png";
          resolve(canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85));
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("bad image"));
      };
      img.src = url;
    });

  /* ---------- init ---------- */
  $("btn-logout-admin").onclick = async () => {
    try {
      await api("POST", "api/auth/logout");
    } catch {
      /* игнорируем */
    }
    location.href = "/cabinet.html";
  };

  document.querySelectorAll("#admin-tabs .btn").forEach((button) => {
    button.onclick = () => switchTab(button.dataset.tab);
  });

  (async () => {
    try {
      const { user } = await api("GET", "api/auth/me");
      state.me = user;
    } catch {
      state.me = null;
    }
    if (!state.me || !["admin", "editor"].includes(state.me.role)) {
      location.href = "/";
      return;
    }
    $("admin-me").textContent = `${state.me.displayName} · ${state.me.role}`;
    if (state.me.role !== "admin") {
      document.querySelectorAll("[data-admin-only]").forEach((element) => {
        element.hidden = true;
      });
    }
    try {
      await loadData();
    } catch (error) {
      status("global-status", error.message, true);
      return;
    }
    document.title = `${state.data.settings.siteTitle || "NRG / INDEX"} — админка`;
    switchTab("drinks");
  })();
})();
