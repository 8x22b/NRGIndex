const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeGtin,
  gtinFromDataMatrix,
  parseScanCode,
  barcodeField,
  lookupOpenFoodFacts,
  lookupChestnyZnak,
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
