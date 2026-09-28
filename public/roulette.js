// Общий барабан рулетки: бесконечная лента и спин без откатов.
// Страницы дают пул и рендер плашки; помощник сам ведёт ленту, анимацию и обрезку.
(() => {
  const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const BATCH = 24; // сколько плашек докидываем за раз
  const MIN_TRAVEL = [5000, 7500]; // минимальный пробег за спин, px
  const DURATION = [6500, 9000];
  const EASE_OUT = "cubic-bezier(.15,.75,.25,1)";
  const EASE_OUT_SLOPE = 5; // y1/x1 у EASE_OUT — для стыковки скоростей

  const shuffled = (pool) => [...pool].sort(() => Math.random() - 0.5);
  const offsetOf = (reel) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(reel).transform);
    return Number.isFinite(m.m41) ? m.m41 : 0;
  };
  const stepOf = (reel) => {
    const [a, b] = reel.children;
    if (a && b) return Math.max(1, b.offsetLeft - a.offsetLeft);
    if (a) return a.offsetWidth + 16;
    return 0;
  };
  const distanceOf = (reel, item) =>
    item.offsetLeft + item.offsetWidth / 2 - reel.parentElement.clientWidth / 2;

  function create(reel, render) {
    let list = [];

    const append = (pool, count) => {
      const html = [];
      while (html.length < count) {
        const copy = shuffled(pool);
        list.push(...copy);
        for (const drink of copy) html.push(render(drink));
      }
      reel.insertAdjacentHTML("beforeend", html.join(""));
    };

    // Убираем уехавшие влево плашки, сдвиг компенсируем — визуально ничего не меняется.
    const trim = () => {
      const offset = offsetOf(reel);
      const step = stepOf(reel);
      let removed = 0;
      let count = 0;
      while (reel.children.length > 2) {
        const first = reel.children[0];
        const screenRight = offset + removed + first.offsetLeft + first.offsetWidth;
        if (screenRight > 0) break;
        removed += step || first.offsetWidth;
        first.remove();
        count += 1;
      }
      if (!count) return;
      list.splice(0, count);
      reel.style.transform = `translateX(${offset + removed}px)`;
    };

    const reset = (pool) => {
      reel.style.transform = "";
      reel.innerHTML = "";
      list = [];
      if (!pool?.length) return;
      append(pool, BATCH);
    };

    // Одна прокрутка: цель всегда впереди текущей позиции, тормозим ровно в неё.
    const spin = async ({ pool, onWinner } = {}) => {
      if (!pool?.length) return null;
      if (!reel.children.length) reset(pool);
      const offset = offsetOf(reel);
      const minTravel = randInt(...MIN_TRAVEL);
      let winnerIndex = -1;
      for (let guard = 0; guard < 20; guard++) {
        winnerIndex = reel.children.length - 1 - randInt(10, 30);
        if (winnerIndex < 0) continue;
        if (distanceOf(reel, reel.children[winnerIndex]) >= -offset + minTravel) break;
        append(pool, BATCH);
      }
      if (winnerIndex < 0) winnerIndex = 0;
      const target = reel.children[winnerIndex];
      const winner = list[winnerIndex];
      const distance = distanceOf(reel, target);
      const travel = -distance - offset; // всегда > 0
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reduce ? 1 : randInt(...DURATION);
      const decelAt = randInt(62, 72) / 100;
      // Скорость на стыке фаз совпадает: без рывка на торможении и без отката.
      const momentum = (EASE_OUT_SLOPE * decelAt) / (1 - decelAt + EASE_OUT_SLOPE * decelAt);
      const mid = offset + travel * momentum;
      const anim = reel.animate(
        [
          { transform: `translateX(${offset}px)`, offset: 0, easing: "linear" },
          { transform: `translateX(${mid}px)`, offset: decelAt, easing: EASE_OUT },
          { transform: `translateX(${-distance}px)`, offset: 1 },
        ],
        { duration, fill: "forwards" },
      );
      await anim.finished;
      anim.cancel();
      reel.style.transform = `translateX(${-distance}px)`;
      for (const item of reel.querySelectorAll(".is-winner")) item.classList.remove("is-winner");
      target.classList.add("is-winner");
      trim();
      onWinner?.(winner, target);
      return winner;
    };

    return { reset, spin };
  }

  window.NrgRoulette = { create };
})();
