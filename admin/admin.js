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

  const state = { me: null, data: null, tab: "drinks", imageDataUrl: null, removeImage: false };
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
        if (!confirm(`Удалить «${drink.name}» целиком?`)) return;
        try {
          await api("DELETE", `api/admin/drinks/${drink.id}`);
          await refresh();
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
        if (!confirm(`Удалить тир ${button.dataset.delete}?`)) return;
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
        <thead><tr><th>Логин</th><th>Имя</th><th>Роль</th><th>Должность</th><th>Пароль</th><th>Статус</th><th></th></tr></thead>
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
              <td class="admin-actions">
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
        if (!confirm(`Сбросить пароль ${user.username}? Старые сессии завершатся.`)) return;
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
        if (!confirm(`Удалить пользователя ${user.username}? Его оценки тоже удалятся.`)) return;
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
    $("u-username").disabled = Boolean(user);
    $("u-name").value = user?.displayName || "";
    $("u-role").value = user?.role || "user";
    $("u-title").value = user?.title || "";
    $("u-initials").value = user?.initials || "";
    $("u-color").value = user?.color || "#9fb7ff";
    $("u-active").checked = user ? user.isActive : true;
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
          displayName: $("u-name").value,
          role: $("u-role").value,
          title: $("u-title").value,
          initials: $("u-initials").value,
          color: $("u-color").value,
          isActive: $("u-active").checked,
        };
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
    $("s-model").value = settings.openrouterModel || "";
    $("s-key").value = "";
    $("s-key").placeholder = settings.openrouterKeySet
      ? "задан — оставьте пустым, чтобы не менять"
      : "не задан";
  };

  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      siteTitle: $("s-title").value,
      siteDescription: $("s-description").value,
      openrouterModel: $("s-model").value,
    };
    if ($("s-key").value) payload.openrouterKey = $("s-key").value;
    try {
      await api("PUT", "api/admin/settings", payload);
      await refresh();
      status("settings-status", "Настройки сохранены ✓");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  });

  $("btn-key-clear").onclick = async () => {
    if (!confirm("Убрать OpenRouter-ключ? ИИ-функции перестанут работать.")) return;
    try {
      await api("PUT", "api/admin/settings", { openrouterKey: "" });
      await refresh();
      status("settings-status", "Ключ убран");
    } catch (error) {
      status("settings-status", error.message, true);
    }
  };

  /* ---------- audit ---------- */
  const renderAudit = () => {
    const rows = state.data.audit || [];
    if (!rows.length) {
      $("audit-table").innerHTML = `<p class="admin-hint">Журнал пуст или недоступен (нужна роль admin).</p>`;
      return;
    }
    $("audit-table").innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td class="muted">${esc(row.created_at)} UTC</td>
              <td>${esc(row.username || "—")}</td>
              <td>${esc(row.action)}</td>
              <td>${esc(row.entity)}${row.entity_id ? ` #${esc(row.entity_id)}` : ""}</td>
              <td class="muted">${esc(row.details)}</td>
            </tr>`,
            )
            .join("")}
        </tbody>
      </table>`;
  };

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
    switchTab("drinks");
  })();
})();
