import {
  heartbeatSession,
  serverTimestamp,
  setJudgeConnection,
  subscribeToConnection,
  subscribeToCompetition,
  subscribeToServerOffset,
  subscribeToSession,
  updateSession
} from './firebase.js';

const PAGE_SIZE = 6;
const params = new URLSearchParams(window.location.search);
const requestedLane = params.get('lane') || '1';
const lane = /^[1-9]\d?$/.test(requestedLane) ? requestedLane : '1';
const $ = (id) => document.getElementById(id);
const state = {
  competition: { status: 'ready' },
  serverOffset: 0,
  connected: false,
  session: null,
  page: 1,
  rafId: null,
  heartbeatId: null,
  connectionPending: true,
  connectionTimedOut: false,
  connectionError: ''
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

const getLaps = () => Array.isArray(state.session?.laps) ? state.session.laps : [];

const renderHeader = () => {
  $('lane').textContent = lane;
  $('laneLabel').textContent = lane;
  $('teamLabel').textContent = state.session?.team || 'Equipo por asignar';
  const step = Number(state.competition.distancePerLap) || 50;
  $('lapBtnSub').textContent = `Sumar +${step} metros`;
};

const renderLaps = (newLap = false) => {
  const laps = getLaps();
  const totalPages = Math.max(1, Math.ceil(laps.length / PAGE_SIZE));
  if (newLap) state.page = 1;
  state.page = Math.min(state.page, totalPages);

  const latest = laps[laps.length - 1];
  $('recentLap').textContent = latest
    ? `Última vuelta: ${laps.length} · ${latest.distance} m · ${formatTime(latest.elapsedMs)}`
    : 'Aún no hay vueltas registradas';
  $('lapCountBadge').textContent = String(laps.length);

  if (!laps.length) {
    $('lapPanelBody').innerHTML = '<div class="empty-state">La sesión actual aparecerá aquí.</div>';
    $('pageLabel').textContent = '0 vueltas';
    $('previousPageBtn').disabled = true;
    $('nextPageBtn').disabled = true;
    return;
  }

  const start = (state.page - 1) * PAGE_SIZE;
  const visibleLaps = laps.slice().reverse().slice(start, start + PAGE_SIZE);
  const rows = visibleLaps.map((lap, index) => `
    <tr>
      <td>${laps.length - start - index}</td>
      <td>${Number(lap.distance) || 0} m</td>
      <td>${formatTime(lap.splitMs)}</td>
      <td>${formatTime(lap.elapsedMs)}</td>
    </tr>
  `).join('');

  $('lapPanelBody').innerHTML = `
    <table class="lap-list">
      <thead><tr><th>Vuelta</th><th>Dist.</th><th>Parcial</th><th>Acum.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  $('pageLabel').textContent = `Página ${state.page} de ${totalPages}`;
  $('previousPageBtn').disabled = state.page >= totalPages;
  $('nextPageBtn').disabled = state.page <= 1;
};

const renderTimer = () => {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  const running = state.competition.status === 'running';
  const elapsed = getElapsed();
  const durationMs = Number(state.competition.durationMs) || 1800000;
  const remaining = Math.max(0, durationMs - elapsed);
  const laps = getLaps();

  $('time').textContent = formatTime(elapsed);
  $('remaining').textContent = formatTime(remaining);
  $('distanceValue').textContent = `${Number(state.session?.totalDistance) || 0} m`;
  $('lapsValue').textContent = String(laps.length);
  $('lapBtn').disabled = !running || !state.connected;
  const ready = state.session?.ready === true;
  $('readyBtn').disabled = !state.connected || running;
  $('readyBtnLabel').textContent = ready ? 'PREPARADO' : 'NO PREPARADO';
  $('readyBtnSub').textContent = ready ? 'Toca para retirar la marca' : 'Toca para confirmar';
  $('readyBtn').classList.toggle('ready', ready);
  $('readyBtn').classList.toggle('not-ready', !ready);
  $('eventStateLabel').textContent = running
    ? remaining === 0 ? 'Tiempo cumplido' : 'Prueba en curso'
    : state.competition.status === 'finished' ? 'Prueba detenida' : 'Esperando al administrador';
  $('eventStateLabel').classList.toggle('warning', running && remaining === 0);
  $('statusPill').textContent = ready ? 'PREPARADO' : 'NO PREPARADO';
  $('statusPill').classList.toggle('ready', ready);
  $('statusPill').classList.toggle('not-ready', !ready);

  if (running) state.rafId = requestAnimationFrame(renderTimer);
};

const renderConnection = () => {
  const notice = $('connectionNotice');
  notice.textContent = state.connected
    ? 'Conectado al evento'
    : state.connectionPending ? 'Conectando con Firestore...'
    : state.connectionError.toLowerCase().includes('permission')
      ? 'Firestore rechazó el acceso. Revisa las reglas de seguridad.'
      : state.connectionError
        ? `Error de Firestore: ${state.connectionError}`
        : 'Firestore no respondió. Revisa internet, reglas y proyecto.';
  notice.classList.toggle('online', state.connected);
  notice.classList.toggle('offline', !state.connected);
  notice.classList.toggle('connecting', state.connectionPending && !state.connected);
  renderTimer();
};

const saveIdentity = async () => {
  const team = $('team').value.trim();
  const judge = $('judge').value.trim();
  $('teamLabel').textContent = team || 'Equipo por asignar';
  try {
    await updateSession(lane, {
      lane,
      team,
      judge,
      totalDistance: Number(state.session?.totalDistance) || 0,
      laps: getLaps(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('No se pudo guardar la información del carril:', error);
  }
};

const registerLap = async () => {
  if (state.competition.status !== 'running' || !state.connected) return;
  const laps = getLaps();
  const elapsedMs = getElapsed();
  const previousElapsed = Number(laps[laps.length - 1]?.elapsedMs) || 0;
  const distancePerLap = Number(state.competition.distancePerLap) || 50;
  const previousDistance = Number(state.session?.totalDistance) || 0;
  const nextDistance = previousDistance + distancePerLap;
  const checkpoints = Array.isArray(state.session?.checkpoints) ? [...state.session.checkpoints] : [];
  for (let checkpoint = (Math.floor(previousDistance / 500) + 1) * 500; checkpoint <= nextDistance; checkpoint += 500) {
    checkpoints.push({
      distance: checkpoint,
      registeredDistance: nextDistance,
      elapsedMs,
      timestamp: new Date(Date.now() + state.serverOffset).toISOString()
    });
  }
  const nextLap = {
    distance: nextDistance,
    splitMs: Math.max(0, elapsedMs - previousElapsed),
    elapsedMs,
    timestamp: new Date(Date.now() + state.serverOffset).toISOString()
  };
  const nextLaps = [...laps, nextLap];

  try {
    await updateSession(lane, {
      lane,
      team: $('team').value.trim(),
      judge: $('judge').value.trim(),
      totalDistance: nextLap.distance,
      elapsedMs,
      laps: nextLaps,
      checkpoints,
      phase: 'running',
      updatedAt: serverTimestamp()
    });
    state.session = { ...state.session, totalDistance: nextLap.distance, laps: nextLaps, checkpoints };
    renderLaps(true);
    renderTimer();
  } catch (error) {
    console.error('No se pudo registrar la vuelta:', error);
    window.alert('No se pudo sincronizar la vuelta. Revisa la conexión.');
  }
};

const toggleReady = async () => {
  if (!state.connected || state.competition.status === 'running') return;
  const ready = state.session?.ready !== true;
  try {
    await updateSession(lane, {
      lane,
      team: $('team').value.trim(),
      judge: $('judge').value.trim(),
      connected: true,
      lastSeenAt: serverTimestamp(),
      ready,
      totalDistance: Number(state.session?.totalDistance) || 0,
      laps: getLaps(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('No se pudo actualizar la preparación:', error);
    state.connected = false;
    state.connectionPending = false;
    state.connectionError = error.message || 'No se pudo sincronizar la preparación.';
    renderConnection();
  }
};

$('team').addEventListener('change', saveIdentity);
$('judge').addEventListener('change', saveIdentity);
$('lapBtn').addEventListener('click', registerLap);
$('readyBtn').addEventListener('click', toggleReady);
$('previousPageBtn').addEventListener('click', () => {
  state.page += 1;
  renderLaps();
});
$('nextPageBtn').addEventListener('click', () => {
  state.page -= 1;
  renderLaps();
});

$('team').value = '';
$('judge').value = '';
renderHeader();
renderLaps();
renderTimer();

subscribeToServerOffset((offset) => {
  state.serverOffset = offset;
  renderTimer();
});

subscribeToConnection(async (connected) => {
  if (connected === null) {
    if (!state.connectionTimedOut) {
      state.connectionPending = true;
      renderConnection();
    }
    return;
  }
  state.connectionPending = false;
  state.connectionTimedOut = false;
  state.connected = connected;
  if (connected) {
    try {
      await setJudgeConnection(lane, true);
      state.connected = true;
      state.connectionError = '';
      if (state.heartbeatId) clearInterval(state.heartbeatId);
      state.heartbeatId = setInterval(() => {
        heartbeatSession(lane).catch((error) => {
          state.connectionError = error.message || 'No se pudo actualizar la conexión del juez.';
          state.connected = false;
          renderConnection();
        });
      }, 10000);
    } catch (error) {
      console.error('No se pudo registrar la conexión del juez:', error);
      state.connected = false;
      state.connectionError = error.message || '';
    }
  } else if (state.heartbeatId) {
    clearInterval(state.heartbeatId);
    state.heartbeatId = null;
  }
  renderConnection();
}, (error) => {
  console.error('Error de conexión con Firebase:', error);
  state.connected = false;
  state.connectionPending = false;
  state.connectionTimedOut = false;
  state.connectionError = error.message || '';
  renderConnection();
});
setTimeout(() => {
  if (!state.connected && state.connectionPending) {
    state.connectionPending = false;
    state.connectionTimedOut = true;
    renderConnection();
  }
}, 12000);

window.addEventListener('offline', () => {
  state.connected = false;
  state.connectionError = '';
  renderConnection();
  setJudgeConnection(lane, false).catch(() => {});
});

subscribeToCompetition((competition) => {
  state.competition = competition;
  renderHeader();
  renderTimer();
});

subscribeToSession(lane, (session) => {
  const previousCount = getLaps().length;
  state.session = session || { lane, team: '', judge: '', totalDistance: 0, laps: [] };
  if (document.activeElement !== $('team')) $('team').value = state.session.team || '';
  if (document.activeElement !== $('judge')) $('judge').value = state.session.judge || '';
  renderHeader();
  renderLaps(getLaps().length > previousCount);
  renderTimer();
});
