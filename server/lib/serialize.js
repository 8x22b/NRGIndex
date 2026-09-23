function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function initialsOf(displayName) {
  const parts = String(displayName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return [...parts[0]].slice(0, 2).join("").toUpperCase();
  return parts
    .slice(0, 2)
    .map((part) => [...part][0].toUpperCase())
    .join("");
}

// В кружок помещается максимум два символа: «ДАУН» -> «ДА», «F» -> «F»
function normalizeInitials(value, displayName) {
  const clean = String(value || "").replace(/\s+/g, "");
  if (clean) return [...clean].slice(0, 2).join("").toUpperCase();
  return initialsOf(displayName);
}

function userToParticipant(row) {
  return {
    id: row.username,
    name: row.display_name,
    initials: normalizeInitials(row.initials, row.display_name),
    role: row.title || "",
    color: row.color || "#9fb7ff",
  };
}

function userToApi(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    title: row.title,
    initials: normalizeInitials(row.initials, row.display_name),
    color: row.color || "#9fb7ff",
    isActive: Boolean(row.is_active),
    isPublic: Boolean(row.is_public),
    mustChangePassword: Boolean(row.must_change_password),
    hasPassword: Boolean(row.password_hash),
    createdAt: row.created_at,
  };
}

function drinkToPublic(row, ratings, relatedSlugs) {
  return {
    id: row.slug,
    brand: row.brand,
    name: row.name,
    flavor: row.flavor,
    edition: row.edition,
    image: row.image_path || "assets/favicon.svg",
    sourceLabel: row.source_label,
    accent: [row.accent_a, row.accent_b],
    related: relatedSlugs,
    ratings,
  };
}

function drinkToAdmin(row, ratings, relatedIds) {
  return {
    id: row.id,
    slug: row.slug,
    brand: row.brand,
    name: row.name,
    flavor: row.flavor,
    edition: row.edition,
    image: row.image_path,
    sourceLabel: row.source_label,
    accent: [row.accent_a, row.accent_b],
    published: Boolean(row.is_published),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    related: relatedIds,
    ratings,
  };
}

module.exports = { formatDate, initialsOf, normalizeInitials, userToParticipant, userToApi, drinkToPublic, drinkToAdmin };
