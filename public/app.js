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
      <button class="view-chip" type="button" data-view="${esc(person.id)}">
        <span class="view-chip__number" style="--person-color:${safeColor(person.color, "#9fb7ff")}">${esc(person.initials || String(index + 1).padStart(2, "0"))}</span>
        <span><b>${esc(person.name)}</b><small>${esc(person.role || `участник ${String(index + 1).padStart(2, "0")}`)}</small></span>
      </button>
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
          <span class="drink-card__rank">${esc(activeView === "average" ? value : rating.tier)}</span>
          <img src="${esc(drink.image)}" alt="Банка ${esc(drink.name)}, ${esc(drink.flavor)}" loading="lazy" decoding="async">
        </span>
        <span class="drink-card__copy">
          <b>${esc(drink.name)}</b>
          <span>${esc(drink.flavor)}</span>
        </span>
      </button>
    `;
  };

  let renderTimer = null;
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
              ${drinks.length ? drinks.map(({ drink, rating }) => cardTemplate(drink, rating)).join("") : `<div class="empty-tier">пока пусто</div>`}
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
      viewDescription.insertAdjacentHTML(
        "beforeend",
        ` <a class="header-cab" href="profile.html?u=${encodeURIComponent(activeView)}">Профиль и отзывы →</a>`,
      );
    }
  };

  const attachCards = () => {
    document.querySelectorAll(".drink-card").forEach((card) => {
      card.addEventListener("click", () => openDrink(card.dataset.drink));

      card.addEventListener("pointermove", (event) => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty("--rx", `${-y * 8}deg`);
        card.style.setProperty("--ry", `${x * 10}deg`);
      });

      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
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
              <span class="related-card__visual"><img src="${esc(related.image)}" alt="Банка ${esc(related.name)}, ${esc(related.flavor)}" loading="lazy" decoding="async"></span>
              <span class="related-card__copy"><b>${esc(related.name)}</b><small>${esc(related.flavor)}</small><i>открыть карточку →</i></span>
            </button>
          `,
            )
            .join("")}
        </div>
      </section>
    `
      : "";

    const reviews = data.participants
      .map((person) => {
        const rating = drink.ratings?.[person.id];
        const hasReview = Boolean(rating?.review?.trim());
        return `
        <article class="review-row">
          <div class="reviewer" style="--person-color:${safeColor(person.color, "#9fb7ff")}">
            <span class="reviewer__avatar">${esc(person.initials)}</span>
            <span><b>${esc(person.name)}</b><small>${esc(person.role)}</small></span>
          </div>
          <div class="review-tier ${rating ? "" : "is-empty"}">${esc(rating?.tier || "—")}</div>
          <p class="review-text">${hasReview ? `«${esc(rating.review)}»` : rating ? "Подробное мнение пока не записано." : "Ещё не пробовал или не выставил оценку."}</p>
          <span class="review-links">
            <button class="review-link" type="button" data-person-view="${esc(person.id)}">тирлист →</button>
            <a class="review-link" href="profile.html?u=${encodeURIComponent(person.id)}">профиль →</a>
          </span>
        </article>
      `;
      })
      .join("");

    dialogContent.innerHTML = `
      <section class="dialog-hero" style="--dialog-a:${safeColor(drink.accent?.[0], "#ff4f79")};--dialog-b:${safeColor(drink.accent?.[1], "#ff7448")}">
        <div class="dialog-product"><img src="${esc(drink.image)}" alt="Банка ${esc(drink.name)}, ${esc(drink.flavor)}"></div>
        <div class="dialog-intro">
          <p class="dialog-kicker">Specimen ${specimenNumber(drink)} · ${esc(drink.edition || drink.brand)}</p>
          <h3 id="dialog-title">${esc(drink.name)}</h3>
          <p class="dialog-flavor">${esc(drink.flavor)}</p>
          <div class="dialog-score">
            <b>${esc(average?.tier || "—")}</b>
            <span>${scoreCopy}</span>
          </div>
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

    dialog.showModal();
    document.body.classList.add("is-dialog-open");
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
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;
    if (outside) closeDialog();
  });
  dialog.addEventListener("close", () => document.body.classList.remove("is-dialog-open"));

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
    // диплинки: ?view=<username> — чей тирлист, ?drink=<slug> — сразу открыть карточку
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    if (view && getParticipant(view)) activeView = view;
    renderBoard();
    const drinkParam = params.get("drink");
    if (drinkParam && getDrink(drinkParam)) {
      history.replaceState(null, "", location.pathname + location.hash);
      openDrink(drinkParam);
    }
  })();
})();
