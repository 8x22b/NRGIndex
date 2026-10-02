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

- `zxing-wasm/reader.js` + `zxing-wasm/zxing_reader.wasm` — браузерная IIFE-сборка
  [zxing-wasm](https://github.com/Sec-ant/zxing-wasm) (лицензия MIT, рядом `zxing-wasm/LICENSE`).
  Сильнее старого ZXing на зашумлённых Data Matrix: живой скан читает кадр локально
  (raw → Otsu-порог с инверсией), сервер остаётся запасным вариантом. Грузится лениво
  при первом сканировании (`loadZXingWasm` в `public/cabinet.js`), не на старте страницы.

  Обновление:

  ```
  npm install zxing-wasm
  cp node_modules/zxing-wasm/dist/iife/reader/index.js public/vendor/zxing-wasm/reader.js
  cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/vendor/zxing-wasm/zxing_reader.wasm
  cp node_modules/zxing-wasm/LICENSE public/vendor/zxing-wasm/LICENSE
  ```
