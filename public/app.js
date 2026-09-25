(() => {
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
  // Адаптивные картинки: srcset/sizes + width/height против сдвигов (CLS).
  const drinkImg = (drink, sizes, eager) => {
    const srcset = drink.imageSrcSet ? ` srcset="${esc(drink.imageSrcSet)}" sizes="${sizes}"` : "";
    const dims = drink.imageWidth ? ` width="${drink.imageWidth}" height="${drink.imageHeight}"` : "";
    return `<img src="${esc(drink.image)}"${srcset}${dims} alt="Банка ${esc(drink.name)}, ${esc(drink.flavor)}" loading="${eager ? "eager" : "lazy"}" decoding="async">`;
  };
  const participantWord = (n) => wordForm(n, ["участник", "участника", "участников"]);

  const board = document.querySelector("#tier-board");
  const tabs = document.querySelector("#participant-tabs");
  const boardLabel = document.querySelector("#board-label");
  const boardMeta = document.querySelector("#board-meta");
  const viewDescription = document.querySelector("#view-description");
  const dialog = document.querySelector("#drink-dialog");
  const dialogContent = document.querySelector("#dialog-content");
  const closeButton = document.querySelector(".dialog-close");
  const headerCount = document.querySelector("#header-count");
  const headerPeople = document.querySelector("#header-people");
  const updateNode = document.querySelector("#last-update");
  const aura = document.querySelector(".cursor-aura");

  let data = null;
  let activeView = "average";

  const getParticipant = (id) => data.participants.find((person) => person.id === id);
  const getDrink = (id) => data.drinks.find((drink) => drink.id === id);
  const getTier = (id) => data.tiers.find((tier) => tier.id === id);
  const specimenNumber = (drink) =>
    String(data.drinks.findIndex((item) => item.id === drink.id) + 1).padStart(3, "0");

  const scoredRatings = (drink) =>
    Object.entries(drink.ratings || {}).filter(([, rating]) => rating && getTier(rating.tier));

  const averageFor = (drink) => {
    const ratings = scoredRatings(drink);
    if (!ratings.length) return null;
    const value = ratings.reduce((sum, [, rating]) => sum + getTier(rating.tier).score, 0) / ratings.length;
    const rounded = Math.round(value);
    const closest = data.tiers.find((tier) => tier.score === rounded) || data.tiers.at(-1);
    return { tier: closest.id, value, votes: ratings.length };
  };

  const ratingForView = (drink, view) => {
    if (view === "average") return averageFor(drink);
    const rating = drink.ratings?.[view];
    return rating
      ? { ...rating, votes: 1, value: getTier(rating.tier)?.score || 0 }
      : null;
  };

  const createTabs = () => {
    tabs.innerHTML = data.participants
      .map(
        (person, index) => `
      <div class="view-chip-wrap">
        <button class="view-chip" type="button" data-view="${esc(person.id)}">
          <span class="view-chip__number" style="--person-color:${safeColor(person.color, "#9fb7ff")}">${person.avatar ? `<img src="${esc(person.avatar)}" alt="">` : esc(person.initials || String(index + 1).padStart(2, "0"))}</span>
          <span><b>${esc(person.name)}</b><small>${esc(person.role || `участник ${String(index + 1).padStart(2, "0")}`)}</small></span>
        </button>
        <a class="view-chip__profile" href="profile.html?u=${encodeURIComponent(person.id)}" aria-label="Открыть профиль ${esc(person.name)}">профиль →</a>
      </div>
    `,
      )
      .join("");
  };

  const cardTemplate = (drink, rating) => {
    const value = rating.value ? rating.value.toFixed(1).replace(".0", "") : rating.tier;
    const accent = safeColor(drink.accent?.[0], tierColor(rating.tier));
    const voteText =
      activeView === "average"
        ? `${rating.votes} ${wordForm(rating.votes, ["голос", "голоса", "голосов"])}`
        : getParticipant(activeView)?.name || "оценка";

    return `
      <button class="drink-card" type="button" data-drink="${esc(drink.id)}" style="--card-accent:${accent}" aria-label="Открыть карточку ${esc(drink.name)}">
        <span class="drink-card__visual">
          <span class="drink-card__votes">${esc(voteText)}</span>
          <span class="drink-card__rank${activeView === "average" ? " is-num" : ""}">${esc(activeView === "average" ? value : rating.tier)}</span>
          ${drinkImg(drink, "(max-width: 720px) 45vw, 240px")}
        </span>
        <span class="drink-card__copy">
          <b>${esc(drink.name)}</b>
          <span>${esc(drink.flavor)}</span>
        </span>
      </button>
    `;
  };

  let renderTimer = null;
  let searchQuery = "";
  let tierFilter = "all";
  const matchesSearch = (drink) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return [drink.brand, drink.name, drink.flavor, drink.edition]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  };
  const isFiltering = () => searchQuery.trim() !== "" || tierFilter !== "all";
  const renderBoard = () => {
    if (!data) return;
    window.clearTimeout(renderTimer);
    board.classList.add("is-changing");

    renderTimer = window.setTimeout(() => {
      const rows = data.tiers
        .map((tier) => {
          const drinks = data.drinks
            .map((drink) => ({ drink, rating: ratingForView(drink, activeView) }))
            .filter((entry) => entry.rating?.tier === tier.id)
            .filter((entry) => (tierFilter === "all" || entry.rating.tier === tierFilter) && matchesSearch(entry.drink))
            .sort((a, b) => {
              const scoreDifference = (b.rating.value || 0) - (a.rating.value || 0);
              if (scoreDifference) return scoreDifference;
              const aOrder = a.rating.order ?? Number.POSITIVE_INFINITY;
              const bOrder = b.rating.order ?? Number.POSITIVE_INFINITY;
              if (aOrder !== bOrder) return aOrder - bOrder;
              return data.drinks.indexOf(a.drink) - data.drinks.indexOf(b.drink);
            });

          return `
          <div class="tier-row" style="--tier-color:${tierColor(tier.id)}">
            <div class="tier-label">
              <span class="tier-letter">${esc(tier.id)}</span>
              <span class="tier-label__copy"><b>${esc(tier.title)}</b><span>${esc(tier.note)}</span></span>
            </div>
            <div class="tier-items">
              ${drinks.length ? drinks.map(({ drink, rating }) => cardTemplate(drink, rating)).join("") : `<div class="empty-tier">${isFiltering() ? "ничего не найдено — ослабьте фильтры" : "пока пусто"}</div>`}
            </div>
          </div>
        `;
        })
        .join("");

      board.innerHTML = rows;
      attachCards();
      board.classList.remove("is-changing");
    }, 170);

    document.querySelectorAll(".view-chip[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === activeView);
    });

    if (activeView === "average") {
      const votes = data.drinks.reduce((sum, drink) => sum + scoredRatings(drink).length, 0);
      boardLabel.textContent = "NRG / CONSENSUS";
      boardMeta.textContent = `${votes} из ${data.drinks.length * data.participants.length} голосов учтено`;
      viewDescription.textContent =
        "Сводный тир считается по всем выставленным оценкам. Пока голос один — вердикт особенно безапелляционный.";
      document.querySelector("#rating-title").textContent = "Общий стол";
    } else {
      const person = getParticipant(activeView);
      const count = data.drinks.filter((drink) => drink.ratings?.[activeView]).length;
      boardLabel.textContent = `NRG / ${String(person?.name || "").toUpperCase()}`;
      boardMeta.textContent = `${count} ${wordForm(count, ["оценка", "оценки", "оценок"])} из ${data.drinks.length}`;
      viewDescription.textContent = count
        ? `Личный тирлист участника «${person?.name || ""}». Здесь чужие голоса ни на что не влияют.`
        : `У ${person?.name || "участника"} пока нет выставленных оценок. Места уже накрыты — осталось начать дегустацию.`;
      document.querySelector("#rating-title").textContent = `Стол: ${person?.name || ""}`;
    }
    if (isFiltering()) {
      const shown = data.drinks.filter((drink) => {
        const rating = ratingForView(drink, activeView);
        return rating && (tierFilter === "all" || rating.tier === tierFilter) && matchesSearch(drink);
      }).length;
      boardMeta.textContent = `найдено: ${shown} ${wordForm(shown, ["банка", "банки", "банок"])}`;
    }
  };

  const attachCards = () => {
    // Без 3D-наклона за курсором: поворот карточки заставлял мелкий текст
    // бейджей тира/оценки перерисовываться каждый кадр — мерцание. Hover живой
    // за счёт подъёма банки (.drink-card:hover img), бейджи стоят мёртво.
    document.querySelectorAll(".drink-card").forEach((card) => {
      card.addEventListener("click", () => openDrink(card.dataset.drink));
    });
  };

  const openDrink = (drinkId) => {
    const drink = getDrink(drinkId);
    if (!drink) return;
    const average = averageFor(drink);
    const votes = scoredRatings(drink).length;
    const scoreCopy = average
      ? `${average.value.toFixed(1)} из 5<br>${votes} ${wordForm(votes, ["оценка", "оценки", "оценок"])} учтено`
      : "оценок пока нет";
    const relatedDrinks = (drink.related || []).map(getDrink).filter(Boolean);
    const relatedMarkup = relatedDrinks.length
      ? `
      <section class="related-drinks">
        <div class="reviews__head"><h4>Похожие энергосы</h4><span>связанные карточки</span></div>
        <div class="related-drinks__grid">
          ${relatedDrinks
            .map(
              (related) => `
            <button class="related-card" type="button" data-related-drink="${esc(related.id)}" style="--related-a:${safeColor(related.accent?.[0], "#ff4f79")};--related-b:${safeColor(related.accent?.[1], "#ff7448")}">
              <span class="related-card__visual">${drinkImg(related, "200px")}</span>
              <span class="related-card__copy"><b>${esc(related.name)}</b><small>${esc(related.flavor)}</small><i>открыть карточку →</i></span>
            </button>
          `,
            )
            .join("")}
        </div>
      </section>
    `
      : "";

    const reviewRow = (person, rating) => {
      const hasReview = Boolean(rating?.review?.trim());
      return `
        <article class="review-row${rating ? "" : " is-untried"}">
          <a class="reviewer" href="profile.html?u=${encodeURIComponent(person.id)}" style="--person-color:${safeColor(person.color, "#9fb7ff")}" aria-label="Открыть профиль ${esc(person.name)}">
            <span class="reviewer__avatar">${person.avatar ? `<img src="${esc(person.avatar)}" alt="">` : esc(person.initials)}</span>
            <span><b>${esc(person.name)}</b><small>${esc(person.role)}</small><i class="reviewer__hint">профиль →</i></span>
          </a>
          <div class="review-tier ${rating ? "" : "is-empty"}">${esc(rating?.tier || "—")}</div>
          <p class="review-text">${hasReview ? `«${esc(rating.review)}»` : rating ? "Подробное мнение пока не записано." : "Ещё не пробовал или не выставил оценку."}</p>
          <span class="review-links">
            <button class="review-link" type="button" data-person-view="${esc(person.id)}">тирлист →</button>
          </span>
        </article>
      `;
    };
    // Оценившие — сверху, не пробовавшие — внизу под своим заголовком.
    const rated = [];
    const untried = [];
    for (const person of data.participants) {
      const rating = drink.ratings?.[person.id];
      (rating ? rated : untried).push({ person, rating });
    }
    const reviews = [
      ...rated.map(({ person, rating }) => reviewRow(person, rating)),
      rated.length && untried.length
        ? `<p class="reviews__subhead">Ещё не пробовали · ${untried.length}</p>`
        : "",
      ...untried.map(({ person, rating }) => reviewRow(person, rating)),
    ].join("");

    dialogContent.innerHTML = `
      <section class="dialog-hero" style="--dialog-a:${safeColor(drink.accent?.[0], "#ff4f79")};--dialog-b:${safeColor(drink.accent?.[1], "#ff7448")}">
        <div class="dialog-product">${drinkImg(drink, "(max-width: 720px) 80vw, 352px", true)}</div>
        <div class="dialog-intro">
          <p class="dialog-kicker">Specimen ${specimenNumber(drink)} · ${esc(drink.edition || drink.brand)}</p>
          <h3 id="dialog-title">${esc(drink.name)}</h3>
          <p class="dialog-flavor">${esc(drink.flavor)}</p>
          <div class="dialog-score">
            <b>${esc(average?.tier || "—")}</b>
            <span>${scoreCopy}</span>
          </div>
          <button class="dialog-share" type="button" data-share-drink="${esc(drink.id)}">скопировать ссылку на банку</button>
        </div>
      </section>
      <section class="reviews">
        <div class="reviews__head"><h4>Что сказали</h4><span>${data.participants.length} ${participantWord(data.participants.length)} · личные вердикты</span></div>
        ${reviews}
      </section>
      ${relatedMarkup}
    `;

    dialogContent.querySelectorAll("[data-related-drink]").forEach((button) => {
      button.addEventListener("click", () => openDrink(button.dataset.relatedDrink));
    });

    dialogContent.querySelectorAll("[data-person-view]").forEach((button) => {
      button.addEventListener("click", () => {
        activeView = button.dataset.personView;
        renderBoard();
        dialog.close();
        document.querySelector("#rating").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    dialogContent.querySelector("[data-share-drink]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const url = `${location.origin}/d/${encodeURIComponent(button.dataset.shareDrink)}`;
      try {
        await navigator.clipboard.writeText(url);
        const original = button.textContent;
        button.textContent = "ссылка готова ✓";
        window.setTimeout(() => {
          button.textContent = original;
        }, 1500);
      } catch {
        button.textContent = "не вышло — ссылка в адресной строке";
      }
    });

    dialog.showModal();
    document.body.classList.add("is-dialog-open");
    // диплинк: открытая карточка живёт на /d/<slug> — можно кидать в чат
    history.replaceState(null, "", `/d/${encodeURIComponent(drink.id)}`);
  };

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  const refreshChrome = () => {
    createTabs();
    headerCount.textContent = `${data.drinks.length} ${wordForm(data.drinks.length, ["образец", "образца", "образцов"])}`;
    headerPeople.textContent = `${data.participants.length} ${participantWord(data.participants.length)}`;
    const heroPeople = document.querySelector("#hero-people");
    if (heroPeople && data.participants.length) {
      const n = data.participants.length;
      heroPeople.textContent = `${n} ${participantWord(n)}. Один общий рейтинг. Никакой объективности — только вкус, настроение и последствия.`;
    }
    updateNode.textContent = data.updatedAt;
  };

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (!viewButton) return;
    activeView = viewButton.dataset.view;
    renderBoard();
    if (viewButton.classList.contains("brand")) {
      document.querySelector("#rating").scrollIntoView({ behavior: "smooth" });
    }
  });

  closeButton.addEventListener("click", closeDialog);
  const searchInput = document.getElementById("board-search");
  searchInput?.addEventListener("input", () => {
    searchQuery = searchInput.value;
    renderBoard();
  });
  document.getElementById("board-filters")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tier-filter]");
    if (!button) return;
    tierFilter = button.dataset.tierFilter;
    document
      .querySelectorAll("[data-tier-filter]")
      .forEach((chip) => chip.classList.toggle("is-active", chip === button));
    renderBoard();
  });
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) closeDialog();
  });
  dialog.addEventListener("close", () => {
    document.body.classList.remove("is-dialog-open");
    if (location.pathname.startsWith("/d/")) history.replaceState(null, "", "/");
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".reveal").forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(element);
  });

  window.addEventListener("pointermove", (event) => {
    if (!aura || window.matchMedia("(pointer: coarse)").matches) return;
    aura.animate(
      { left: `${event.clientX}px`, top: `${event.clientY}px` },
      { duration: 900, fill: "forwards", easing: "cubic-bezier(.22,1,.36,1)" },
    );
  });

  const marqueeTrack = document.querySelector(".marquee__track");
  let marqueeResizeTimer = null;
  const setupMarquee = () => {
    if (!marqueeTrack) return;
    const original = marqueeTrack.dataset.original || marqueeTrack.innerHTML;
    marqueeTrack.dataset.original = original;
    marqueeTrack.innerHTML = original;
    let copies = 1;
    while (marqueeTrack.scrollWidth < window.innerWidth * 2 && copies < 10) {
      marqueeTrack.innerHTML += original;
      copies += 1;
    }
    if (copies % 2 === 1) marqueeTrack.innerHTML += original;
  };
  window.addEventListener("resize", () => {
    window.clearTimeout(marqueeResizeTimer);
    marqueeResizeTimer = window.setTimeout(setupMarquee, 250);
  });
  setupMarquee();

  (async () => {
    try {
      const res = await fetch("api/public/summary", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (error) {
      board.innerHTML = `<div class="empty-tier">Не удалось загрузить данные: ${esc(error.message)}</div>`;
      return;
    }
    if (data.site?.title) document.title = `${data.site.title} — тирлист энергетиков`;
    const brandName = document.querySelector(".brand__name");
    if (brandName && data.site?.title && data.site.title !== "NRG / INDEX") {
      brandName.textContent = data.site.title;
    }
    const meta = document.querySelector('meta[name="description"]');
    if (meta && data.site?.description) meta.setAttribute("content", data.site.description);
    refreshChrome();
    // диплинки: ?view=<username> — чей тирлист, /d/<slug> или ?drink=<slug> — сразу открыть карточку
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (view && getParticipant(view)) activeView = view;
    renderBoard();
    const pathDrink = location.pathname.match(/^\/d\/([^/]+?)\/?$/)?.[1];
    const drinkParam = (pathDrink ? decodeURIComponent(pathDrink) : params.get("drink")) || "";
    if (drinkParam && getDrink(drinkParam)) {
      history.replaceState(null, "", location.pathname + location.hash);
      openDrink(drinkParam);
    }
  })();
})();
