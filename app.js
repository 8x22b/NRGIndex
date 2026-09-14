(() => {
  const data = window.NRG_DATA;
  if (!data) return;

  const tierColors = {
    S: "#ff5f5a",
    A: "#f1a653",
    B: "#e7d471",
    C: "#8ebd93",
    D: "#8093b7"
  };

  const board = document.querySelector("#tier-board");
  const tabs = document.querySelector("#participant-tabs");
  const boardLabel = document.querySelector("#board-label");
  const boardMeta = document.querySelector("#board-meta");
  const viewDescription = document.querySelector("#view-description");
  const dialog = document.querySelector("#drink-dialog");
  const dialogContent = document.querySelector("#dialog-content");
  const closeButton = document.querySelector(".dialog-close");
  const headerCount = document.querySelector("#header-count");
  const updateNode = document.querySelector("#last-update");
  const aura = document.querySelector(".cursor-aura");

  let activeView = "average";

  const wordForm = (value, forms) => {
    const n = Math.abs(value) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  };

  const getParticipant = (id) => data.participants.find((person) => person.id === id);
  const getDrink = (id) => data.drinks.find((drink) => drink.id === id);
  const getTier = (id) => data.tiers.find((tier) => tier.id === id);
  const specimenNumber = (drink) => String(data.drinks.findIndex((item) => item.id === drink.id) + 1).padStart(3, "0");

  const scoredRatings = (drink) => Object.entries(drink.ratings || {}).filter(([, rating]) => rating && getTier(rating.tier));

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
    return rating ? { ...rating, votes: 1, value: getTier(rating.tier)?.score || 0 } : null;
  };

  const createTabs = () => {
    tabs.innerHTML = data.participants.map((person, index) => `
      <button class="view-chip" type="button" data-view="${person.id}">
        <span class="view-chip__number" style="--person-color:${person.color}">${person.initials || String(index + 1).padStart(2, "0")}</span>
        <span><b>${person.name}</b><small>${person.role || `участник ${String(index + 1).padStart(2, "0")}`}</small></span>
      </button>
    `).join("");
  };

  const cardTemplate = (drink, rating) => {
    const value = rating.value ? rating.value.toFixed(1).replace(".0", "") : rating.tier;
    const accent = drink.accent?.[0] || tierColors[rating.tier];
    const voteText = activeView === "average"
      ? `${rating.votes} ${wordForm(rating.votes, ["голос", "голоса", "голосов"])}`
      : getParticipant(activeView)?.name || "оценка";

    return `
      <button class="drink-card" type="button" data-drink="${drink.id}" style="--card-accent:${accent}" aria-label="Открыть карточку ${drink.name}">
        <span class="drink-card__visual">
          <span class="drink-card__votes">${voteText}</span>
          <span class="drink-card__rank">${activeView === "average" ? value : rating.tier}</span>
          <img src="${drink.image}" alt="Банка ${drink.name}, ${drink.flavor}">
        </span>
        <span class="drink-card__copy">
          <b>${drink.name}</b>
          <span>${drink.flavor}</span>
        </span>
      </button>
    `;
  };

  const renderBoard = () => {
    board.classList.add("is-changing");

    window.setTimeout(() => {
      const rows = data.tiers.map((tier) => {
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
          <div class="tier-row" style="--tier-color:${tierColors[tier.id]}">
            <div class="tier-label">
              <span class="tier-letter">${tier.id}</span>
              <span class="tier-label__copy"><b>${tier.title}</b><span>${tier.note}</span></span>
            </div>
            <div class="tier-items">
              ${drinks.length ? drinks.map(({ drink, rating }) => cardTemplate(drink, rating)).join("") : `<div class="empty-tier">пока пусто</div>`}
            </div>
          </div>
        `;
      }).join("");

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
      viewDescription.textContent = "Сводный тир считается по всем выставленным оценкам. Пока голос один — вердикт особенно безапелляционный.";
      document.querySelector("#rating-title").textContent = "Общий стол";
    } else {
      const person = getParticipant(activeView);
      const count = data.drinks.filter((drink) => drink.ratings?.[activeView]).length;
      boardLabel.textContent = `NRG / ${person.name.toUpperCase()}`;
      boardMeta.textContent = `${count} ${wordForm(count, ["оценка", "оценки", "оценок"])} из ${data.drinks.length}`;
      viewDescription.textContent = count
        ? `Личный тирлист участника «${person.name}». Здесь чужие голоса ни на что не влияют.`
        : `У ${person.name} пока нет выставленных оценок. Места уже накрыты — осталось начать дегустацию.`;
      document.querySelector("#rating-title").textContent = `Стол: ${person.name}`;
    }
  };

  const attachCards = () => {
    document.querySelectorAll(".drink-card").forEach((card) => {
      card.addEventListener("click", () => openDrink(card.dataset.drink));

      card.addEventListener("pointermove", (event) => {
        if (window.matchMedia("(pointer: coarse)").matches) return;
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - .5;
        const y = (event.clientY - rect.top) / rect.height - .5;
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
    const average = averageFor(drink);
    const votes = scoredRatings(drink).length;
    const scoreCopy = average
      ? `${average.value.toFixed(1)} из 5<br>${votes} ${wordForm(votes, ["оценка", "оценки", "оценок"])} учтено`
      : "оценок пока нет";
    const relatedDrinks = (drink.related || []).map(getDrink).filter(Boolean);
    const relatedMarkup = relatedDrinks.length ? `
      <section class="related-drinks">
        <div class="reviews__head"><h4>Похожие NRGOS’ы</h4><span>связанные карточки</span></div>
        <div class="related-drinks__grid">
          ${relatedDrinks.map((related) => `
            <button class="related-card" type="button" data-related-drink="${related.id}" style="--related-a:${related.accent?.[0] || "#ff4f79"};--related-b:${related.accent?.[1] || "#ff7448"}">
              <span class="related-card__visual"><img src="${related.image}" alt="Банка ${related.name}, ${related.flavor}"></span>
              <span class="related-card__copy"><b>${related.name}</b><small>${related.flavor}</small><i>открыть карточку →</i></span>
            </button>
          `).join("")}
        </div>
      </section>
    ` : "";

    const reviews = data.participants.map((person) => {
      const rating = drink.ratings?.[person.id];
      const hasReview = Boolean(rating?.review?.trim());
      return `
        <article class="review-row">
          <div class="reviewer" style="--person-color:${person.color}">
            <span class="reviewer__avatar">${person.initials}</span>
            <span><b>${person.name}</b><small>${person.role}</small></span>
          </div>
          <div class="review-tier ${rating ? "" : "is-empty"}">${rating?.tier || "—"}</div>
          <p class="review-text">${hasReview ? `«${rating.review}»` : (rating ? "Подробное мнение пока не записано." : "Ещё не пробовал или не выставил оценку.")}</p>
          <button class="review-link" type="button" data-person-view="${person.id}">тирлист →</button>
        </article>
      `;
    }).join("");

    dialogContent.innerHTML = `
      <section class="dialog-hero" style="--dialog-a:${drink.accent?.[0] || "#ff4f79"};--dialog-b:${drink.accent?.[1] || "#ff7448"}">
        <div class="dialog-product"><img src="${drink.image}" alt="Банка ${drink.name}, ${drink.flavor}"></div>
        <div class="dialog-intro">
          <p class="dialog-kicker">Specimen ${specimenNumber(drink)} · ${drink.edition || drink.brand}</p>
          <h3 id="dialog-title">${drink.name}</h3>
          <p class="dialog-flavor">${drink.flavor}</p>
          <div class="dialog-score">
            <b>${average?.tier || "—"}</b>
            <span>${scoreCopy}</span>
          </div>
        </div>
      </section>
      <section class="reviews">
        <div class="reviews__head"><h4>Что сказали</h4><span>${data.participants.length} участника · личные вердикты</span></div>
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

  createTabs();
  headerCount.textContent = `${data.drinks.length} ${wordForm(data.drinks.length, ["образец", "образца", "образцов"])}`;
  updateNode.textContent = data.updatedAt;

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (!viewButton) return;
    activeView = viewButton.dataset.view;
    renderBoard();
    if (viewButton.classList.contains("brand")) document.querySelector("#rating").scrollIntoView({ behavior: "smooth" });
  });

  closeButton.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeDialog();
  });
  dialog.addEventListener("close", () => document.body.classList.remove("is-dialog-open"));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: .12 });
  document.querySelectorAll(".reveal").forEach((element, index) => {
    element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
    observer.observe(element);
  });

  window.addEventListener("pointermove", (event) => {
    if (!aura || window.matchMedia("(pointer: coarse)").matches) return;
    aura.animate({ left: `${event.clientX}px`, top: `${event.clientY}px` }, { duration: 900, fill: "forwards", easing: "cubic-bezier(.22,1,.36,1)" });
  });

  renderBoard();
})();
