// Чистая математика кропа аватара — без DOM, чтобы проверялась юнит-тестом.
// Кроп всегда квадратный: сторона = меньшая сторона картинки, делённая на зум.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.nrgAvatarCrop = api;
})(typeof globalThis === "undefined" ? this : globalThis, () => {
  const MAX_ZOOM = 3;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const cropSide = (width, height, zoom) =>
    Math.min(width, height) / clamp(Number(zoom) || 1, 1, MAX_ZOOM);

  // Центр кропа не выходит за картинку: половина квадрата всегда внутри.
  const cropCenter = (value, side, size) => clamp(Number(value) || 0, side / 2, size - side / 2);

  // Квадрат кропа в координатах картинки: { side, x, y } — top-left и сторона.
  const cropRect = (width, height, zoom, cx, cy) => {
    const side = cropSide(width, height, zoom);
    return {
      side,
      x: cropCenter(cx, side, width) - side / 2,
      y: cropCenter(cy, side, height) - side / 2,
    };
  };

  return { MAX_ZOOM, clamp, cropSide, cropCenter, cropRect };
});
