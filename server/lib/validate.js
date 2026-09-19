const { badRequest } = require("./errors");

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

function str(value, field, { min = 1, max = 300, required = true } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw badRequest(`Поле «${field}» должно быть текстом`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw badRequest(`Поле «${field}» обязательно`);
    return "";
  }
  if (trimmed.length < min) throw badRequest(`Поле «${field}» короче ${min} символов`);
  if (trimmed.length > max) throw badRequest(`Поле «${field}» длиннее ${max} символов`);
  return trimmed;
}

function username(value) {
  const v = str(value, "Логин", { min: 3, max: 32 }).toLowerCase();
  if (!USERNAME_RE.test(v)) {
    throw badRequest("Логин: латиница/цифры/дефис/подчёркивание, начинается с буквы или цифры");
  }
  return v;
}

function password(value) {
  const v = typeof value === "string" ? value : "";
  if (v.length < 8) throw badRequest("Пароль — минимум 8 символов");
  if (v.length > 200) throw badRequest("Пароль слишком длинный");
  return v;
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw badRequest(`Поле «${field}» имеет недопустимое значение`);
  return value;
}

function int(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw badRequest(`Поле «${field}» обязательно`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`Поле «${field}» должно быть целым числом`);
  if (n < min || n > max) throw badRequest(`Поле «${field}» вне диапазона ${min}..${max}`);
  return n;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function color(value, field, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw badRequest(`Поле «${field}» должно быть цветом вида #RRGGBB`);
  }
  return value.toLowerCase();
}

function slugify(text) {
  return (
    String(text || "")
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "drink"
  );
}

const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAGIC = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) =>
    b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
};

function imageFromDataUrl(dataUrl, { maxBytes }) {
  const v = typeof dataUrl === "string" ? dataUrl.trim() : "";
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(v);
  if (!match) throw badRequest("Ожидается data:image/*;base64");
  const mime = match[1].toLowerCase();
  const ext = IMAGE_TYPES[mime];
  if (!ext) throw badRequest("Поддерживаются только PNG, JPEG и WebP");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw badRequest("Пустое изображение");
  if (buffer.length > maxBytes) {
    throw badRequest(`Файл больше ${Math.round(maxBytes / 1024 / 1024)} МБ`);
  }
  if (!MAGIC[ext](buffer)) throw badRequest("Содержимое не совпадает с заявленным типом изображения");
  return { mime, ext, buffer };
}

function idArray(value, field, { max = 200 } = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`Поле «${field}» должно быть массивом`);
  if (value.length > max) throw badRequest(`Поле «${field}»: максимум ${max} элементов`);
  return [...new Set(value.map((item) => int(item, field, { min: 1 })))];
}

module.exports = {
  str,
  username,
  password,
  oneOf,
  int,
  bool,
  color,
  slugify,
  imageFromDataUrl,
  idArray,
  HEX_COLOR,
};
