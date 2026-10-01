const sharp = require("sharp");
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  PlanarYUVLuminanceSource,
} = require("@zxing/library");
const { badRequest } = require("./errors");

const OFF_BASE = "https://world.openfoodfacts.org/api/v2/product";
const CRPT_URL = "https://mobile.api.crpt.ru/mobile/check";
const UA = "NRGIndex/2.0 (energy drink tier list)";
const OFF_TIMEOUT_MS = 8000;
const CRPT_TIMEOUT_MS = 5000;

const digits = (value) => String(value || "").replace(/\D/g, "");

// mod-10 GTIN: валидны 8/12/13/14 цифр (EAN-8, UPC-A, EAN-13, GTIN-14).
function validGtin(value) {
  const clean = digits(value);
  if (![8, 12, 13, 14].includes(clean.length)) return false;
  let sum = 0;
  const body = clean.slice(0, -1).split("").reverse();
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(clean.at(-1));
}

// Канонический код для базы и Open Food Facts: 12 → 13, 14 с ведущим 0 → 13.
function normalizeGtin(value) {
  const clean = digits(value);
  if (!validGtin(clean)) return null;
  if (clean.length === 14 && clean.startsWith("0")) return clean.slice(1);
  if (clean.length === 12) return `0${clean}`;
  return clean;
}

// Data Matrix Честного знака: 01<GTIN14>21<серийник>… — берём GTIN.
function gtinFromDataMatrix(value) {
  const match = String(value || "").match(/01(\d{14})/);
  if (!match || !validGtin(match[1])) return null;
  return normalizeGtin(match[1]);
}

function parseScanCode(value) {
  const raw = String(value || "").trim();
  if (!raw) throw badRequest("Пустой код");
  if (/^\d{8,14}$/.test(raw)) {
    const gtin = normalizeGtin(raw);
    if (!gtin) throw badRequest("Штрих-код не проходит проверку контрольной цифры");
    return { kind: "ean", gtin, raw };
  }
  const gtin = gtinFromDataMatrix(raw);
  if (gtin) return { kind: "datamatrix", gtin, raw };
  throw badRequest("Это не штрих-код и не код Честного знака");
}

// Для формы: пусто → "", иначе канонический GTIN или 400.
function barcodeField(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const gtin = normalizeGtin(raw);
  if (!gtin) throw badRequest("Штрих-код должен быть EAN/UPC (8–14 цифр) с верной контрольной цифрой");
  return gtin;
}

async function lookupOpenFoodFacts(gtin, { fetchImpl = fetch } = {}) {
  const url =
    `${OFF_BASE}/${encodeURIComponent(gtin)}.json` +
    "?fields=product_name,product_name_ru,brands,quantity,product_quantity,product_quantity_unit,image_front_url,categories,nutriments";
  const res = await fetchImpl(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const p = data?.status === 1 ? data.product : null;
  if (!p) return null;
  const name = String(p.product_name_ru || p.product_name || "").trim();
  const brands = String(p.brands || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!name && !brands.length) return null;
  const n = p.nutriments || {};
  const volume =
    String(p.quantity || "").trim() ||
    (p.product_quantity ? `${p.product_quantity} ${p.product_quantity_unit || ""}`.trim() : "");
  return {
    source: "openfoodfacts",
    brand: brands[0] || name.split(/\s+/)[0] || "",
    name: name || brands[0],
    flavor: "",
    volume,
    image: /^https:\/\/images\.openfoodfacts\.org\//.test(p.image_front_url || "") ? p.image_front_url : "",
    caffeineMg: Math.round((Number(n.caffeine_serving) || 0) * 1000),
    kcal: Math.round(Number(n["energy-kcal_serving"]) || 0),
    sugarG: Math.round(Number(n.sugars_serving) || 0),
  };
}

// Неофициальный consumer-API: не ответил/ошибка/не нашёл — молча null.
async function lookupChestnyZnak(rawCode, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(CRPT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        "user-agent": UA,
      },
      body: new URLSearchParams({ cis: String(rawCode || "") }).toString(),
      signal: AbortSignal.timeout(CRPT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data || data.success === false) return null;
    const name = String(data.productName || data.product_name || data.name || data.product?.name || "").trim();
    const brand = String(data.brand || data.brandName || data.product?.brand || "").trim();
    const gtin = normalizeGtin(data.gtin || data.codeResolveData?.gtin || "");
    if (!name && !brand && !gtin) return null;
    return { source: "crpt", brand, name, flavor: "", gtin };
  } catch {
    return null;
  }
}

// Читаем код с фото сами: обычный кадр, контрастный и инвертированный, каждый —
// в четырёх поворотах. Так переживают блики, тени и съёмку «вверх ногами» —
// то, на чём спотыкается единственная попытка камерного API.
const DECODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.DATA_MATRIX,
];
const DECODE_MAX_SIDE = 1600;

function decodePrepared(raw, info, hints) {
  const source = new PlanarYUVLuminanceSource(
    Uint8ClampedArray.from(raw),
    info.width,
    info.height,
    0,
    0,
    info.width,
    info.height,
    false,
  );
  const reader = new MultiFormatReader();
  try {
    reader.setHints(hints);
    const result = reader.decodeWithState(new BinaryBitmap(new HybridBinarizer(source)));
    return {
      code: String(result.getText() || "").trim(),
      format: String(BarcodeFormat[result.getBarcodeFormat()] || "").toLowerCase(),
    };
  } catch {
    return null;
  } finally {
    reader.reset();
  }
}

async function decodeBarcodeImage(buffer, { maxSide = DECODE_MAX_SIDE } = {}) {
  // Кадр держим в PNG: повороты raw-буфера sharp делает некорректно.
  const prepared = await sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, DECODE_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);

  for (const rotation of [0, 180, 90, 270]) {
    const frame = rotation ? await sharp(prepared).rotate(rotation).png().toBuffer() : prepared;
    const base = () => sharp(frame).grayscale().normalise();
    const variants = [
      await base().raw().toBuffer({ resolveWithObject: true }),
      await base().linear(1.6, -40).sharpen().raw().toBuffer({ resolveWithObject: true }),
      await base().negate().raw().toBuffer({ resolveWithObject: true }),
    ];
    for (const variant of variants) {
      const found = decodePrepared(variant.data, variant.info, hints);
      if (found?.code) return found;
    }
  }
  return null;
}

module.exports = {
  validGtin,
  normalizeGtin,
  gtinFromDataMatrix,
  parseScanCode,
  barcodeField,
  lookupOpenFoodFacts,
  lookupChestnyZnak,
  decodeBarcodeImage,
};
