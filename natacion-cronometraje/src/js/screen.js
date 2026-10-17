import {
  subscribeToConnection,
  subscribeToCompetition,
  subscribeToServerOffset,
  subscribeToSessions
} from './firebase.js';

const $ = (id) => document.getElementById(id);
const state = {
  competition: { status: 'ready' },
  serverOffset: 0,
  rafId: null
};

const formatTime = (ms) => {
  const safe = Math.max(0, Number(ms) || 0);
  const totalHundreds = Math.floor(safe / 10);
  const minutes = Math.floor(totalHundreds / 6000);
  const seconds = Math.floor((totalHundreds / 100) % 60);
  const hundredths = totalHundreds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const getElapsed = () => {
  if (state.competition.status === 'running' && Number(state.competition.startedAt)) {
    return Math.max(0, Date.now() + state.serverOffset - state.competition.startedAt);
  }
  return Math.max(0, Number(state.competition.elapsedMs) || 0);
};

const renderTimer = () => {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  const running = state.competition.status === 'running';
  const elapsed = getElapsed();
  const durationMs = Number(state.competition.durationMs) || 1800000;
  const remaining = Math.max(0, durationMs - elapsed);
  $('eventTime').textContent = formatTime(elapsed);
  $('eventRemaining').textContent = `Restante: ${formatTime(remaining)}`;
  $('eventRemaining').classList.toggle('warning', running && remaining === 0);
  $('eventStatus').textContent = running
    ? 'En curso'
    : state.competition.status === 'finished' ? 'Finalizado' : 'Preparado';
  $('eventStatus').classList.toggle('running', running);
  $('eventStatus').classList.toggle('finished', state.competition.status === 'finished');
  if (running) state.rafId = requestAnimationFrame(renderTimer);
};

const renderTable = (sessions) => {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    $('tableBody').innerHTML = '<tr><td colspan="7" class="empty-state">Esperando información de los jueces...</td></tr>';
    return;
  }

  const ranked = [...sessions].sort((a, b) => {
    const distanceDiff = (Number(b.totalDistance) || 0) - (Number(a.totalDistance) || 0);
    if (distanceDiff !== 0) return distanceDiff;
    return (Number(a.elapsedMs) || 0) - (Number(b.elapsedMs) || 0);
  });

  $('tableBody').innerHTML = ranked.map((session, index) => `
    <tr>
      <td class="rank">${index + 1}</td>
      <td>${escapeHtml(session.lane)}</td>
      <td>${escapeHtml(session.team || 'Equipo sin nombre')}</td>
      <td>${escapeHtml(session.judge || 'Sin juez')}</td>
      <td>${Number(session.totalDistance) || 0} m</td>
      <td class="time">${session.laps?.length ? formatTime(session.elapsedMs) : '—'}</td>
      <td>${Array.isArray(session.laps) ? session.laps.length : 0}</td>
    </tr>
  `).join('');
};

subscribeToServerOffset((offset) => {
  state.serverOffset = offset;
  renderTimer();
});
subscribeToConnection((connected) => {
  const badge = $('screenConnection');
  if (connected === null) {
    badge.textContent = 'Conectando con Firestore...';
    badge.classList.remove('online', 'offline');
    badge.classList.add('connecting');
    return;
  }
  badge.textContent = connected ? 'Firestore conectado' : 'Sin conexión';
  badge.classList.toggle('online', connected);
  badge.classList.toggle('offline', !connected);
  badge.classList.remove('connecting');
}, (error) => {
  const badge = $('screenConnection');
  badge.textContent = /permission|insufficient/i.test(error.message) ? 'Revisar reglas de Firestore' : 'Error de Firestore';
  badge.classList.remove('online');
  badge.classList.remove('connecting');
  badge.classList.add('offline');
});
subscribeToCompetition((competition) => {
  state.competition = competition;
  renderTimer();
});
subscribeToSessions(renderTable, (error) => {
  $('screenConnection').textContent = error.message.toLowerCase().includes('permission')
    ? 'Sin permisos de lectura en Firestore'
    : 'No se pudieron cargar los registros';
  $('screenConnection').classList.remove('online');
  $('screenConnection').classList.add('offline');
});
renderTimer();
