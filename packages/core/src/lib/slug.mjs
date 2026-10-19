// AC-28
/**
 * @param {string} topic
 * @returns {string}
 */
export function slugify(topic) {
  let s = String(topic).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  s = s.slice(0, 60);
  s = s.replace(/-+$/g, '');
  return s === '' ? 'research' : s;
}
