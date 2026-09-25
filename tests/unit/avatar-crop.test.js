const test = require("node:test");
const assert = require("node:assert/strict");
const { cropRect, cropSide, MAX_ZOOM } = require("../../public/avatar-crop");

test("кроп аватара: квадрат, зум и зажим в границы картинки", () => {
  // широкое фото, зум 1: сторона = меньшей стороне, центр свободен по горизонтали
  assert.deepEqual(cropRect(400, 200, 1, 200, 100), { side: 200, x: 100, y: 0 });
  // центр за краем — квадрат прижимается к границе, а не выходит за неё
  assert.deepEqual(cropRect(400, 200, 1, 0, 0), { side: 200, x: 0, y: 0 });
  assert.deepEqual(cropRect(400, 200, 1, 999, 999), { side: 200, x: 200, y: 0 });
  // зум уменьшает сторону кропа
  assert.equal(cropSide(400, 200, 2), 100);
  assert.deepEqual(cropRect(400, 200, 2, 100, 100), { side: 100, x: 50, y: 50 });
  // зум зажат в 1..MAX_ZOOM
  assert.equal(cropSide(400, 200, 0), 200);
  assert.equal(cropSide(400, 200, 99), 200 / MAX_ZOOM);
});
