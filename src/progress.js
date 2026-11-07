export const storageKey = 'loki-por-dentro:v1';
export function readProgress(storage, modules) {
  const empty = { completed: [], answers: {}, last: modules[0].id };
  try {
    const parsed = JSON.parse(storage.getItem(storageKey));
    if (!parsed || typeof parsed !== 'object') return empty;
    const ids = new Set(modules.map(module => module.id));
    const answers = {};
    for (const module of modules) {
      const saved = parsed.answers?.[module.id];
      if (!saved || typeof saved !== 'object') continue;
      answers[module.id] = {};
      module.quiz.forEach((quiz,index) => {
        if (Number.isInteger(saved[index]) && saved[index] >= 0 && saved[index] < quiz.options.length) answers[module.id][index] = saved[index];
      });
    }
    return { completed: [...new Set(Array.isArray(parsed.completed) ? parsed.completed.filter(id => ids.has(id)) : [])], answers, last: ids.has(parsed.last) ? parsed.last : empty.last };
  } catch { return empty; }
}
export function saveProgress(storage, progress) {
  try { storage.setItem(storageKey, JSON.stringify(progress)); return true; } catch { return false; }
}
