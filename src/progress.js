export const storageKey = 'loki-por-dentro:v1';

// Respostas salvas valem só para a versão do questionário em que foram dadas.
// Módulos antigos não registravam versão: tratamos a ausência como versão 1.
export const versionsOf = modules => Object.fromEntries(modules.map(module => [module.id, module.quizVersion || 1]));
export const emptyProgress = (modules, last = modules[0].id) => ({ completed: [], answers: {}, quizVersions: versionsOf(modules), last });

export function readProgress(storage, modules) {
  const empty = emptyProgress(modules);
  try {
    const parsed = JSON.parse(storage.getItem(storageKey));
    if (!parsed || typeof parsed !== 'object') return empty;
    const ids = new Set(modules.map(module => module.id));
    const answers = {};
    const quizVersions = {};
    for (const module of modules) {
      const version = module.quizVersion || 1;
      quizVersions[module.id] = version;
      const saved = parsed.answers?.[module.id];
      const savedVersion = Number.isInteger(parsed.quizVersions?.[module.id]) ? parsed.quizVersions[module.id] : 1;
      if (!saved || typeof saved !== 'object' || savedVersion !== version) continue;
      answers[module.id] = {};
      module.quiz.forEach((quiz, index) => {
        if (Number.isInteger(saved[index]) && saved[index] >= 0 && saved[index] < quiz.options.length) answers[module.id][index] = saved[index];
      });
    }
    return { completed: [...new Set(Array.isArray(parsed.completed) ? parsed.completed.filter(id => ids.has(id)) : [])], answers, quizVersions, last: ids.has(parsed.last) ? parsed.last : empty.last };
  } catch { return empty; }
}

export function saveProgress(storage, progress) {
  try { storage.setItem(storageKey, JSON.stringify(progress)); return true; } catch { return false; }
}
