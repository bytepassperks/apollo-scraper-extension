export function progressText(state) {
  if (state?.error) return state.error;
  if (state?.running) return `Pages fetched: ${state.pages || 0} · Records collected: ${state.records || 0}`;
  if (state?.result) return `Complete · ${state.records || 0} records`;
  if (state?.stopped) return `Stopped · ${state.records || 0} records`;
  return "Idle";
}

export function canDownload(state) {
  return Boolean(state?.records);
}
