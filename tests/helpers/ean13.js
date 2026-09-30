// Генератор EAN-13 для тестов: zxing-js умеет только декодировать, поэтому
// рисуем код сами по специфике (L/G/R-таблицы + паттерн чётности первой цифры).
const sharp = require("sharp");

const L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

const checkDigit = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
};

// Код EAN-13 (12 цифр — досчитаем контрольную) → строка модулей "0"/"1".
function ean13Modules(code) {
  const digits = String(code).replace(/\D/g, "");
  const body = digits.length === 13 ? digits.slice(0, 12) : digits;
  if (body.length !== 12) throw new Error("нужно 12 или 13 цифр");
  const full = body + checkDigit(body);
  const parity = PARITY[Number(full[0])];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    bits += (parity[i] === "L" ? L : G)[Number(full[i + 1])];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += R[Number(full[i + 7])];
  return bits + "101";
}

// PNG с кодом: scale — ширина модуля в пикселях, quiet — тихая зона в модулях.
async function ean13Png(code, { scale = 3, height = 120, quiet = 12 } = {}) {
  const bits = "0".repeat(quiet) + ean13Modules(code) + "0".repeat(quiet);
  const width = bits.length * scale;
  const raw = Buffer.alloc(width * height, 255);
  for (let x = 0; x < bits.length; x++) {
    if (bits[x] !== "1") continue;
    for (let dot = 0; dot < scale; dot++) {
      const px = x * scale + dot;
      for (let y = 0; y < height; y++) raw[y * width + px] = 0;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

module.exports = { ean13Modules, ean13Png, checkDigit };
