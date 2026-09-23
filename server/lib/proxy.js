const { ProxyAgent, Socks5ProxyAgent, fetch: undiciFetch } = require("undici");
const { badRequest } = require("./errors");

const PROTOCOLS = ["http:", "https:", "socks5:", "socks:"];
const MASK = "***";

/** Проверяет и нормализует адрес прокси. Пустая строка — прокси выключен. */
function normalizeProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest("Прокси: нужен полный адрес, например http://user:pass@host:3128 или socks5://host:1080");
  }
  if (!PROTOCOLS.includes(url.protocol)) throw badRequest("Прокси: только http, https или socks5");
  if (!url.hostname) throw badRequest("Прокси: не указан хост");
  if (url.pathname && url.pathname !== "/") throw badRequest("Прокси: адрес без пути");
  if (url.search || url.hash) throw badRequest("Прокси: адрес без ?query и #hash");
  if (url.password === MASK) throw badRequest("Прокси: введите пароль целиком");
  return url.href.replace(/\/$/, "");
}

/** Адрес для показа в админке: пароль скрыт. */
function maskProxyUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.password) url.password = MASK;
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

const agents = new Map();

function agentFor(proxyUrl) {
  let agent = agents.get(proxyUrl);
  if (agent) return agent;
  const url = new URL(proxyUrl);
  agent = url.protocol.startsWith("socks")
    ? new Socks5ProxyAgent(proxyUrl)
    : new ProxyAgent({ uri: proxyUrl, proxyTunnel: true });
  // старые агенты (после смены прокси в админке) закрываем
  for (const [key, old] of agents) {
    agents.delete(key);
    old.close().catch(() => {});
  }
  agents.set(proxyUrl, agent);
  return agent;
}

/**
 * fetch, который ходит через прокси. Без прокси — обычный глобальный fetch.
 * Глобальный FormData undici-fetch не понимает, поэтому multipart заранее
 * сериализуем через Response — заголовок с boundary сохраняется.
 */
function proxiedFetch(proxyUrl) {
  if (!proxyUrl) return fetch;
  return async (url, init = {}) => {
    let { body, headers } = init;
    if (body instanceof FormData) {
      const encoded = new Response(body);
      headers = { ...(headers || {}), "content-type": encoded.headers.get("content-type") };
      body = Buffer.from(await encoded.arrayBuffer());
    }
    try {
      return await undiciFetch(url, { ...init, body, headers, dispatcher: agentFor(proxyUrl) });
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
      const reason = error?.cause?.message || error?.message || "ошибка";
      const wrapped = new Error(`прокси: ${reason}`);
      wrapped.cause = error;
      throw wrapped;
    }
  };
}

module.exports = { normalizeProxyUrl, maskProxyUrl, proxiedFetch, MASK };
