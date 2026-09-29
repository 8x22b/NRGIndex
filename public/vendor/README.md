# Вендорные библиотеки

- `zxing.min.js` — UMD-сборка [@zxing/library](https://github.com/zxing-js/library) (лицензия Apache-2.0, рядом `zxing.LICENSE`).
  Нужна для распознавания штрих-кодов на клиенте в браузерах без `BarcodeDetector`
  (Firefox, Safari): грузится лениво только при запуске живого сканирования — `public/cabinet.html`.

  Обновление:

  ```
  npm install @zxing/library
  copy node_modules/@zxing/library/umd/index.min.js public/vendor/zxing.min.js
  copy node_modules/@zxing/library/LICENSE public/vendor/zxing.LICENSE
  ```
