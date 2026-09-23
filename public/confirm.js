// Модальное подтверждение опасных действий: nrgConfirm({ title, message, confirmText }) → Promise<boolean>
(() => {
  let dialog = null;

  const build = () => {
    dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-labelledby", "confirm-title");
    dialog.innerHTML = `
      <form method="dialog" class="confirm-dialog__body">
        <h2 id="confirm-title"></h2>
        <p class="confirm-dialog__message"></p>
        <ul class="confirm-dialog__details" hidden></ul>
        <div class="confirm-dialog__actions">
          <button class="btn btn--ghost" value="cancel" type="submit" data-cancel>Отмена</button>
          <button class="btn btn--danger-solid" value="ok" type="submit" data-ok>Удалить</button>
        </div>
      </form>`;
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close("cancel");
    });
    document.body.append(dialog);
  };

  window.nrgConfirm = ({
    title = "Точно?",
    message = "",
    details = [],
    confirmText = "Удалить",
    cancelText = "Отмена",
    danger = true,
  } = {}) =>
    new Promise((resolve) => {
      if (!dialog) build();
      if (dialog.open) dialog.close("cancel");
      dialog.querySelector("#confirm-title").textContent = title;
      dialog.querySelector(".confirm-dialog__message").textContent = message;
      const list = dialog.querySelector(".confirm-dialog__details");
      list.replaceChildren(
        ...details.filter(Boolean).map((line) => {
          const li = document.createElement("li");
          li.textContent = line;
          return li;
        }),
      );
      list.hidden = !list.children.length;
      const ok = dialog.querySelector("[data-ok]");
      ok.textContent = confirmText;
      ok.className = danger ? "btn btn--danger-solid" : "btn";
      dialog.querySelector("[data-cancel]").textContent = cancelText;
      dialog.returnValue = "";
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok"), { once: true });
      dialog.showModal();
      dialog.querySelector("[data-cancel]").focus();
    });
})();
