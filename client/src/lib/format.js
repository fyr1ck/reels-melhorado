export function bytes(n) {
  if (n == null) return '—';
  const mb = n / 1048576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function duration(sec) {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const dt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const d = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const t = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const dateTime = (v) => (v ? dt.format(new Date(v)) : '—');
export const date = (v) => (v ? d.format(new Date(v)) : '—');
export const time = (v) => (v ? t.format(new Date(v)) : '—');

/** "em 3 h", "há 2 d" — leitura mais rápida que a data completa em listas. */
export function relative(value) {
  if (!value) return '—';
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

  const unidades = [
    [86400000, 'day'], [3600000, 'hour'], [60000, 'minute'], [1000, 'second'],
  ];
  for (const [ms, unidade] of unidades) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unidade);
  }
  return 'agora';
}

export function days(n) {
  if (n == null) return '—';
  if (n < 1) return `${Math.round(n * 24)} h`;
  return `${n} ${n === 1 ? 'dia' : 'dias'}`;
}
