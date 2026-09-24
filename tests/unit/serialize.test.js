const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeInitials, userToParticipant, userToApi } = require("../../server/lib/serialize");

test("инициалы нормализуются до двух символов", () => {
  assert.equal(normalizeInitials("ДАУН", "Рома"), "ДА");
  assert.equal(normalizeInitials("F", "Саня"), "F");
  assert.equal(normalizeInitials("", "Рома"), "РО");
  assert.equal(normalizeInitials("", "Саня Тестов"), "СТ");
});

test("длинные инициалы не ломают кружок и титул сохраняется", () => {
  const row = {
    id: 3,
    username: "roma",
    display_name: "Рома",
    initials: "ДАУН",
    title: "долбаеб",
    role: "user",
    is_active: 1,
    is_public: 1,
    must_change_password: 0,
    has_password: 1,
    color: "#00ff00",
    created_at: "2026-01-01",
  };
  const participant = userToParticipant(row);
  assert.equal(participant.initials, "ДА");
  assert.equal(participant.role, "долбаеб");
  assert.equal(userToApi(row).initials, "ДА");
});
