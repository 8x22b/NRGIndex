const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeGtin,
  gtinFromDataMatrix,
  parseScanCode,
  barcodeField,
  lookupOpenFoodFacts,
  lookupChestnyZnak,
  lookupBarcodeList,
  parseBarcodeListPage,
} = require("../../server/lib/barcode");

test("normalizeGtin: канонизирует EAN/UPC/GTIN и режет неверные", () => {
  assert.equal(normalizeGtin("4680036912629"), "4680036912629");
  assert.equal(normalizeGtin("036000291452"), "0036000291452");
  assert.equal(normalizeGtin("04680036912629"), "4680036912629");
  assert.equal(normalizeGtin("96385074"), "96385074");
  assert.equal(normalizeGtin("4680036912620"), null);
  assert.equal(normalizeGtin("123"), null);
});

test("gtinFromDataMatrix: вытаскивает GTIN из кода Честного знака", () => {
  assert.equal(gtinFromDataMatrix("0104680036912629215Fabc"), "4680036912629");
  assert.equal(gtinFromDataMatrix("0104680036912620"), null);
  assert.equal(gtinFromDataMatrix("мусор"), null);
});

test("parseScanCode: различает EAN и Data Matrix, отклоняет мусор", () => {
  assert.deepEqual(parseScanCode("4680036912629"), { kind: "ean", gtin: "4680036912629", raw: "4680036912629" });
  const dm = parseScanCode("0104680036912629215Fabc");
  assert.equal(dm.kind, "datamatrix");
  assert.equal(dm.gtin, "4680036912629");
  assert.throws(() => parseScanCode("привет"), /не штрих-код/);
  assert.throws(() => parseScanCode("4680036912620"), /контрольной/);
});

test("barcodeField: пусто остаётся пустым, мусор отклоняется", () => {
  assert.equal(barcodeField(""), "");
  assert.throws(() => barcodeField("мусор"), /Штрих-код/);
});

test("lookupOpenFoodFacts: товар, нет товара и HTTP-ошибка", async () => {
  const product = {
    status: 1,
    product: {
      product_name: "Gorilla energy drink",
      quantity: "450 ml",
      image_front_url: "https://images.openfoodfacts.org/x.jpg",
      nutriments: { caffeine_serving: 0.135, "energy-kcal_serving": 225, sugars_serving: 54 },
    },
  };
  const fetchImpl = async () => ({ ok: true, json: async () => product });
  const found = await lookupOpenFoodFacts("4680036912629", { fetchImpl });
  assert.equal(found.source, "openfoodfacts");
  assert.equal(found.brand, "Gorilla");
  assert.equal(found.name, "Gorilla energy drink");
  assert.equal(found.volume, "450 ml");
  assert.equal(found.image, "https://images.openfoodfacts.org/x.jpg");
  assert.equal(found.caffeineMg, 135);
  assert.equal(found.kcal, 225);
  assert.equal(found.sugarG, 54);

  assert.equal(await lookupOpenFoodFacts("4680036912629", { fetchImpl: async () => ({ ok: true, json: async () => ({ status: 0 }) }) }), null);
  assert.equal(await lookupOpenFoodFacts("4680036912629", { fetchImpl: async () => ({ ok: false }) }), null);
});

test("lookupChestnyZnak: GTIN из ответа, отказ и ошибка сети", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ success: true, productName: "X", brand: "Y", codeResolveData: { gtin: "04680036912629" } }),
  });
  const found = await lookupChestnyZnak("0104680036912629215Fabc", { fetchImpl });
  assert.equal(found.source, "crpt");
  assert.equal(found.gtin, "4680036912629");
  assert.equal(found.name, "X");
  assert.equal(found.brand, "Y");

  assert.equal(
    await lookupChestnyZnak("0104680036912629215Fabc", { fetchImpl: async () => ({ ok: true, json: async () => ({ success: false }) }) }),
    null,
  );
  assert.equal(
    await lookupChestnyZnak("0104680036912629215Fabc", {
      fetchImpl: async () => {
        throw new Error("network down");
      },
    }),
    null,
  );
});

test("barcode-list: разбирает страницу с товаром и берёт читаемое название", () => {
  const html = `<!doctype html><html><head>
    <title>Напиток энергитический Адреналин Раш жб 0.25л - Штрих-код: 4600494223013</title></head>
    <body><table class="randomBarcodes"><tr><th>№</th><th>Штрих-код</th></tr>
    <tr class="even"><td>1</td><td>4600494223013</td><td>НАПИТОК ЭНЕРГИТИЧЕСКИЙ АДРЕНАЛИН РАШ ЖБ 0.25Л</td><td>ШТ.</td><td>581</td></tr>
    <tr class="odd"><td>3</td><td>4600494223013</td><td>НАПИТОК АДРЕНАЛИН РАШ</td><td>ШТ</td><td>5</td></tr>
    </table></body></html>`;
  assert.deepEqual(parseBarcodeListPage(html, "4600494223013"), {
    source: "barcode-list",
    name: "Напиток энергитический Адреналин Раш жб 0.25л",
  });
});

test("barcode-list: без таблицы или чужого кода — null", () => {
  assert.equal(parseBarcodeListPage("<html><body>ничего не нашлось</body></html>", "4600494223013"), null);
  const other = `<table class="randomBarcodes"><tr class="odd"><td>1</td><td>1111111111116</td><td>ЧУЖОЙ ТОВАР</td><td>ШТ</td><td>1</td></tr></table>`;
  assert.equal(parseBarcodeListPage(other, "4600494223013"), null);
});

test("lookupBarcodeList: ходит за HTML и переживает ошибку", async () => {
  const calls = [];
  const html = `<html><head><title>Флеш Ап Апельсиновый ритм 0.45л. жб - Штрих-код: 4600682003106</title></head>
    <body><table class="randomBarcodes"><tr class="even"><td>1</td><td>4600682003106</td><td>ФЛЕШ АП АПЕЛЬСИНОВЫЙ РИТМ</td><td>ШТ.</td><td>260</td></tr></table></body></html>`;
  const found = await lookupBarcodeList("4600682003106", {
    fetchImpl: async (url, init) => {
      calls.push(String(url));
      assert.match(String(init?.headers?.["user-agent"]), /NRGIndex/);
      return new Response(html, { status: 200 });
    },
  });
  assert.equal(found.name, "Флеш Ап Апельсиновый ритм 0.45л. жб");
  assert.match(calls[0], /barcode-list\.ru/);
  assert.match(calls[0], /barcode=4600682003106/);

  assert.equal(await lookupBarcodeList("4600682003106", { fetchImpl: async () => new Response("no", { status: 500 }) }), null);
});

// Заводских энкодеров в zxing-js нет, поэтому рисуем код сами (tests/helpers/ean13.js).
test("ean13-хелпер: контрольная цифра по спецификации", () => {
  const { checkDigit } = require("../helpers/ean13");
  assert.equal(checkDigit("468003691262"), "9");
});

test("decodeBarcodeImage: читает фото в поворотах, инверсии и смазанное", async () => {
  const sharp = require("sharp");
  const { ean13Png } = require("../helpers/ean13");
  const { decodeBarcodeImage } = require("../../server/lib/barcode");

  const png = await ean13Png("468003691262");
  const variants = [
    ["прямо", png],
    ["вверх ногами", await sharp(png).rotate(180).toBuffer()],
    ["снято боком", await sharp(png).rotate(90).toBuffer()],
    ["снято боком 270", await sharp(png).rotate(270).toBuffer()],
    ["инверсия", await sharp(png).negate().toBuffer()],
    ["смазанное фото", await sharp(png).blur(1.1).jpeg({ quality: 60 }).toBuffer()],
    ["тёмное фото", await sharp(png).linear(0.6, -40).toBuffer()],
  ];
  for (const [label, buffer] of variants) {
    const found = await decodeBarcodeImage(buffer);
    assert.equal(found?.code, "4680036912629", `${label}: код должен читаться`);
    assert.equal(found?.format, "ean_13");
  }

  const blank = await sharp({
    create: { width: 800, height: 240, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  assert.equal(await decodeBarcodeImage(blank), null, "пустой кадр ничего не выдумывает");
});
