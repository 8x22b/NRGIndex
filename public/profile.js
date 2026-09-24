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
  const tierColors = { S: "#ff5f5a", A: "#f1a653", B: "#e7d471", C: "#8ebd93", D: "#8093b7" };
  const tierColor = (id) => tierColors[id] || "#ff4f79";
  const ratingImg = (rating) => {
    const srcset = rating.imageSrcSet ? ` srcset="${esc(rating.imageSrcSet)}" sizes="(max-width: 720px) 45vw, 240px"` : "";
    const dims = rating.imageWidth ? ` width="${rating.imageWidth}" height="${rating.imageHeight}"` : "";
    return `<img src="${esc(imgSrc(rating.image))}"${srcset}${dims} alt="Банка ${esc(rating.name)}" loading="lazy" decoding="async">`;
  };
  // картинки из БД бывают относительными (assets/...) — страница может жить не в корне
  const imgSrc = (src) => (/^(\/|https?:|data:)/.test(src || "") ? src : `/${src || "assets/favicon.svg"}`);

  const getJson = async (url) => {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
    return json;
  };

  const username = new URLSearchParams(location.search).get("u") || "";

  const renderPeople = (participants, active) => {
    $("profile-people").innerHTML = participants
      .map(
        (person) => `
        <a class="view-chip ${person.id === active ? "is-active" : ""}" href="/profile.html?u=${encodeURIComponent(person.id)}">
          <span class="view-chip__number" style="--person-color:${safeColor(person.color, "#9fb7ff")}">${esc(person.initials)}</span>
          <span><b>${esc(person.name)}</b><small>${esc(person.role || "участник")}</small></span>
        </a>`,
      )
      .join("");
  };

  const renderHero = ({ profile, stats, tiers }) => {
    const color = safeColor(profile.color, "#9fb7ff");
    const max = Math.max(1, ...Object.values(stats.distribution));
    const bars = tiers
      .map((tier) => {
        const n = stats.distribution[tier.id] || 0;
        return `
        <div class="dist-bar" style="--tier-color:${tierColor(tier.id)}">
          <span class="dist-bar__count">${n}</span>
          <span class="dist-bar__fill" style="height:${Math.round((n / max) * 100)}%"></span>
          <b>${esc(tier.id)}</b>
        </div>`;
      })
      .join("");
    const avgTier = stats.average
      ? tiers.reduce((best, tier) =>
          Math.abs(tier.score - stats.average) < Math.abs(best.score - stats.average) ? tier : best,
        )
      : null;
    const agreementCopy =
      stats.agreement === null
        ? "не с кем сравнить"
        : stats.agreement >= 80
          ? "почти всегда как все"
          : stats.agreement >= 60
            ? "в целом согласен со столом"
            : "идёт против стола";

    $("profile-hero").innerHTML = `
      <div class="profile-id" style="--person-color:${color}">
        <span class="profile-avatar">${esc(profile.initials)}</span>
        <div>
          <p class="eyebrow">Участник${profile.since ? ` · с ${esc(profile.since)}` : ""}</p>
          <h1>${esc(profile.name)}</h1>
          <p class="profile-role">${esc(profile.role || "дегустатор без титула")}</p>
        </div>
      </div>
      <div class="profile-stats">
        <div><b>${stats.ratings}</b><span>${wordForm(stats.ratings, ["оценка", "оценки", "оценок"])}</span></div>
        <div><b>${stats.reviews}</b><span>${wordForm(stats.reviews, ["отзыв", "отзыва", "отзывов"])}</span></div>
        <div><b>${stats.added}</b><span>${wordForm(stats.added, ["банку добавил", "банки добавил", "банок добавил"])}</span></div>
        <div><b>${avgTier ? esc(avgTier.id) : "—"}</b><span>${stats.average ? `средний тир · ${String(stats.average).replace(".", ",")}` : "средний тир"}</span></div>
        <div><b>${stats.agreement === null ? "—" : `${stats.agreement}%`}</b><span>${agreementCopy}</span></div>
      </div>
      <div class="profile-dist" aria-label="Распределение по тирам">${bars}</div>
    `;
  };

  const cardTemplate = (rating) => `
    <a class="drink-card" href="/d/${encodeURIComponent(rating.drink)}" style="--card-accent:${safeColor(rating.accent?.[0], tierColor(rating.tier))}">
      <span class="drink-card__visual">
        ${rating.othersAvg !== null ? `<span class="drink-card__votes">стол: ${String(rating.othersAvg).replace(".", ",")}</span>` : ""}
        <span class="drink-card__rank">${esc(rating.tier)}</span>
        ${ratingImg(rating)}
      </span>
      <span class="drink-card__copy">
        <b>${esc(rating.name)}</b>
        <span>${esc(rating.flavor)}</span>
      </span>
    </a>`;

  const renderBoard = ({ tiers, ratings }) => {
    $("profile-board-block").hidden = false;
    $("profile-board-meta").textContent = `${ratings.length} ${wordForm(ratings.length, ["банка", "банки", "банок"])}`;
    $("profile-board").innerHTML = tiers
      .map((tier) => {
        const items = ratings.filter((rating) => rating.tier === tier.id);
        return `
        <div class="tier-row" style="--tier-color:${tierColor(tier.id)}">
          <div class="tier-label">
            <span class="tier-letter">${esc(tier.id)}</span>
            <span class="tier-label__copy"><b>${esc(tier.title)}</b><span>${esc(tier.note)}</span></span>
          </div>
          <div class="tier-items">
            ${items.length ? items.map(cardTemplate).join("") : `<div class="empty-tier">пока пусто</div>`}
          </div>
        </div>`;
      })
      .join("");
  };

  const renderReviews = ({ ratings }) => {
    const withText = ratings.filter((rating) => rating.review.trim());
    $("profile-reviews-block").hidden = false;
    $("profile-reviews-meta").textContent = withText.length ? "свежие сверху" : "";
    $("profile-reviews").innerHTML = withText.length
      ? withText
          .map((rating) => {
            const diff = rating.othersAvg === null ? null : Math.round(({ S: 5, A: 4, B: 3, C: 2, D: 1 }[rating.tier] || 0) - rating.othersAvg);
            const verdict =
              diff === null ? "" : diff >= 1 ? "выше стола" : diff <= -1 ? "ниже стола" : "как у стола";
            return `
            <article class="profile-review">
              <img src="${esc(imgSrc(rating.image))}" alt="" loading="lazy">
              <div>
                <b>${esc(rating.name)}</b>
                <small>${esc([rating.flavor, rating.updatedAt].filter(Boolean).join(" · "))}</small>
                <p>«${esc(rating.review)}»</p>
              </div>
              <div class="profile-review__tier" style="--tier-color:${tierColor(rating.tier)}">
                <b>${esc(rating.tier)}</b>${verdict ? `<small>${verdict}</small>` : ""}
              </div>
            </article>`;
          })
          .join("")
      : `<p class="hint">Словами пока ничего не сказал — только тиры.</p>`;
  };

  const renderHistory = ({ history }) => {
    const block = $("profile-history-block");
    if (!block) return;
    if (!history?.length) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    $("profile-history-meta").textContent = `${history.length} ${wordForm(history.length, ["событие", "события", "событий"])}`;
    $("profile-history").innerHTML = history
      .map((item) => {
        const link = item.slug
          ? `<a href="/d/${encodeURIComponent(item.slug)}">карточка →</a>`
          : "";
        return `
        <div class="history-row">
          <time datetime="${esc(String(item.at || "").replace(" ", "T"))}Z">${esc(formatWhen(item.at))}</time>
          <p>${esc(item.summary || "изменение")}</p>
          ${link}
        </div>`;
      })
      .join("");
  };

  const formatWhen = (value) => {
    const date = new Date(String(value || "").replace(" ", "T") + "Z");
    if (Number.isNaN(date.getTime())) return String(value || "");
    return date.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  (async () => {
    let summary = null;
    try {
      summary = await getJson("/api/public/summary");
    } catch {
      /* без списка участников профиль всё равно покажем */
    }
    const target = username || summary?.participants?.[0]?.id;
    renderPeople(summary?.participants || [], target);
    if (!target) {
      $("profile-hero").innerHTML = `<p class="hint">Участников пока нет.</p>`;
      return;
    }
    if (!username) history.replaceState(null, "", `/profile.html?u=${encodeURIComponent(target)}`);
    try {
      const data = await getJson(`/api/public/profile/${encodeURIComponent(target)}`);
      const title = summary?.site?.title || "NRG / INDEX";
      document.title = `${data.profile.name} — ${title}`;
      renderHero(data);
      renderBoard(data);
      renderReviews(data);
      renderHistory(data);
    } catch (error) {
      $("profile-hero").innerHTML = `
        <p class="eyebrow">404</p>
        <h1 class="profile-missing">Профиль не найден</h1>
        <p class="hint">${esc(error.message)}. Возможно, участник скрыт или ссылка устарела.</p>`;
    }
  })();
})();
