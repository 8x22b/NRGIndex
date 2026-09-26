// Числа как барабан счётчика: каждая цифра прокручивается до своей.
// Вызывать после перерисовки блока: nrgCountUp(root). Разметка: <b data-count="42">…</b>
(() => {
  const DIGITS = "0123456789";
  const fmt = (value) => new Intl.NumberFormat("ru-RU").format(value);

  const digitColumn = (digit, index, count) => {
    const column = document.createElement("span");
    column.className = "count-digit";
    column.style.setProperty("--digit", "0");
    column.style.setProperty("--delay", `${(count - 1 - index) * 90}ms`);
    column.dataset.digit = String(digit);
    const strip = document.createElement("i");
    strip.className = "count-digit__strip";
    strip.setAttribute("aria-hidden", "true");
    for (const d of DIGITS) {
      const cell = document.createElement("span");
      cell.textContent = d;
      strip.append(cell);
    }
    column.append(strip);
    return column;
  };

  window.nrgCountUp = (root = document) => {
    root.querySelectorAll("[data-count]").forEach((node) => {
      const target = Number(node.dataset.count) || 0;
      const text = fmt(target);
      node.classList.add("count-number");
      node.setAttribute("aria-label", text);
      node.replaceChildren();
      [...text].forEach((char, index, chars) => {
        if (!/\d/.test(char)) {
          const sep = document.createElement("span");
          sep.className = "count-sep";
          sep.textContent = char;
          node.append(sep);
          return;
        }
        node.append(digitColumn(Number(char), index, chars.length));
      });
      if (target <= 0) return;
      // форсируем отрисовку нуля, чтобы transition поехал именно с него
      void node.offsetHeight;
      node.querySelectorAll(".count-digit").forEach((column) => {
        column.style.setProperty("--digit", column.dataset.digit);
      });
    });
  };
})();
