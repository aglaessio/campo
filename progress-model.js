(() => {
  const ids = (values, total = 32) => [...new Set((Array.isArray(values) ? values : [])
    .filter(id => Number.isInteger(id) && id >= 0 && id < total))].sort((a, b) => a - b);
  function visitedIds(data, total = 32) {
    const legacyLast = !Array.isArray(data.visited) && Number.isInteger(data.lastLesson) ? [data.lastLesson] : [];
    const noteIds = Object.keys(data.notes || {}).filter(key => /^\d+$/.test(key)).map(Number);
    return ids([...ids(data.visited, total), ...ids(data.completed, total), ...ids(data.practice, total),
      ...ids(data.passed, total), ...noteIds, ...legacyLast], total);
  }
  function summary(data, total = 32) {
    const practice = ids(data.practice, total), passed = ids(data.passed, total);
    const completed = ids(data.completed, total).filter(id => practice.includes(id) && passed.includes(id));
    const visited = visitedIds(data, total);
    return {completed: completed.length, visited: visited.length,
      percent: total ? Math.round(completed.length / total * 100) : 0,
      lastLesson: Number.isInteger(data.lastLesson) && data.lastLesson >= 0 && data.lastLesson < total ? data.lastLesson : 0};
  }
  globalThis.CampoProgress = Object.freeze({ids, visitedIds, summary});
})();
