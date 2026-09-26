// Плавный набор чисел: <b data-count="42">0</b> набегает от нуля до 42.
// Вызывать после перерисовки блока: nrgCountUp(root).
(() => {
  const fmt = (value) => new Intl.NumberFormat("ru-RU").format(value);
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.nrgCountUp = (root = document) => {
    root.querySelectorAll("[data-count]").forEach((node) => {
      const target = Number(node.dataset.count) || 0;
      if (reduceMotion() || target <= 0) {
        node.textContent = fmt(target);
        return;
      }
      const started = performance.now();
      const duration = 650;
      const tick = (now) => {
        const k = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        node.textContent = fmt(Math.round(target * eased));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
})();
