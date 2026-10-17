import {
  serverTimestamp,
  setCompetitionState,
  subscribeToConnection,
  subscribeToCompetition,
  subscribeToServerOffset,
  subscribeToSessions,
  updateSession
} from './firebase.js';

const $ = (id) => document.getElementById(id);
const state = {
  competition: { status: 'ready' },
  sessions: [],
  serverOffset: 0,
  connected: false,
  connectionPending: true,
  connectionTimedOut: false,
  connectionError: '',
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

const getDistanceStep = () => $('distanceStep').value === 'custom'
  ? Math.max(1, Number($('customStep').value) || 1)
  : Number($('distanceStep').value);

const getDurationMs = () => {
  const duration = $('duration').value === 'custom'
    ? Math.max(1, Number($('customDuration').value) || 1) * 60
    : Number($('duration').value);
  return duration * 1000;
};

const parseExpectedLanes = () => {
  const input = $('expectedLanes').value.trim();
  if (!input) return { lanes: [], error: 'Escribe al menos un carril.' };

  const lanes = new Set();
  for (const part of input.split(',').map((value) => value.trim())) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      if (first < 1 || last > 99 || first > last) return { lanes: [], error: 'Usa carriles del 1 al 99 y rangos ascendentes.' };
      for (let lane = first; lane <= last; lane += 1) lanes.add(String(lane));
      continue;
    }
    if (!/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 99) {
      return { lanes: [], error: 'Formato inválido. Ejemplos: 1, 3, 5-8.' };
    }
    lanes.add(String(Number(part)));
  }

  return { lanes: [...lanes].sort((a, b) => Number(a) - Number(b)), error: '' };
};

const getExpectedLanes = () => parseExpectedLanes().lanes;

const getSession = (lane) => state.sessions.find((session) => String(session.lane) === lane);
const isSessionConnected = (session) => session?.connected === true
  && Number(session.lastSeenAt) > 0
  && Date.now() - Number(session.lastSeenAt) < 30000;

const getReadyCount = () => getExpectedLanes().filter((lane) => {
  const session = getSession(lane);
  return isSessionConnected(session) && session.ready === true;
}).length;

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
  const durationMs = Number(state.competition.durationMs) || getDurationMs();
  const remaining = Math.max(0, durationMs - elapsed);
  $('time').textContent = formatTime(elapsed);
  $('eventRemaining').textContent = `Restante: ${formatTime(remaining)}`;
  $('eventRemaining').classList.toggle('warning', running && remaining === 0);
  $('statusPill').textContent = running
    ? 'En curso'
    : state.competition.status === 'finished' ? 'Finalizado' : 'Preparado';
  $('statusPill').classList.toggle('running', running);
  $('statusPill').classList.toggle('finished', state.competition.status === 'finished');
  $('eventMessage').textContent = running
    ? remaining === 0 ? 'Tiempo cumplido; detener manualmente' : 'La prueba está sincronizada con todos los dispositivos'
    : state.competition.status === 'finished' ? 'Tiempo oficial detenido' : 'Listo para iniciar';
  renderReadiness();
  $('stopBtn').disabled = !running;
  $('distanceStep').disabled = running;
  $('customStep').disabled = running || $('distanceStep').value !== 'custom';
  $('duration').disabled = running;
  $('customDuration').disabled = running || $('duration').value !== 'custom';

  if (running) state.rafId = requestAnimationFrame(renderTimer);
};

const renderReadiness = () => {
  const { lanes: expectedLanes, error } = parseExpectedLanes();
  const readyCount = getReadyCount();
  const connectedCount = expectedLanes.filter((lane) => isSessionConnected(getSession(lane))).length;
  const allReady = state.connected && !error && expectedLanes.length > 0 && readyCount === expectedLanes.length;
  $('laneListHint').textContent = error || 'Usa comas o rangos. La tabla mostrará solo estos carriles.';
  $('laneListHint').classList.toggle('invalid', Boolean(error));
  $('readinessSummary').textContent = error
    ? error
    : `Jueces conectados: ${connectedCount}/${expectedLanes.length} · preparados: ${readyCount}/${expectedLanes.length}`;
  $('startBtn').disabled = state.competition.status === 'running' || !allReady;

  const connection = $('connectionStatus');
  connection.textContent = state.connected
    ? 'Firestore conectado'
    : state.connectionPending ? 'Conectando con Firestore...'
    : state.connectionError.toLowerCase().includes('permission')
      ? 'Firestore rechazó el acceso. Revisa las reglas de seguridad.'
      : state.connectionError
        ? `Error de Firestore: ${state.connectionError}`
        : 'Firestore no respondió. Revisa internet, reglas y proyecto.';
  connection.classList.toggle('online', state.connected);
  connection.classList.toggle('offline', !state.connected);
  connection.classList.toggle('connecting', state.connectionPending && !state.connected);
};

const renderTable = () => {
  const lanes = getExpectedLanes();
  $('recordCount').textContent = String(lanes.filter((lane) => getSession(lane)).length);
  $('tableBody').innerHTML = lanes.map((lane) => {
    const session = getSession(lane);
    const laps = Array.isArray(session?.laps) ? session.laps : [];
    const latestLap = laps[laps.length - 1];
    const laneStatus = !isSessionConnected(session) ? 'Sin conectar' : session?.ready ? 'Preparado' : 'Falta preparar';
    return `
      <tr>
        <td>${lane}</td>
        <td>${escapeHtml(session?.team || '—')}</td>
        <td>${escapeHtml(session?.judge || '—')}</td>
        <td>${laneStatus}</td>
        <td>${laps.length}</td>
        <td>${Number(session?.totalDistance) || 0} m</td>
        <td>${latestLap ? formatTime(session?.elapsedMs) : '—'}</td>
      </tr>
    `;
  }).join('');
  renderReadiness();
};

$('startBtn').addEventListener('click', async () => {
  if (state.competition.status === 'running') return;
  const expectedLanes = getExpectedLanes();
  if (!state.connected || !expectedLanes.length || getReadyCount() !== expectedLanes.length) return;
  const hasPreviousLaps = expectedLanes.some((lane) => (getSession(lane)?.laps?.length || 0) > 0);
  if (hasPreviousLaps && !window.confirm('Al iniciar una nueva prueba se borrarán las vueltas actuales. ¿Continuar?')) return;

  try {
    await Promise.all(expectedLanes.map((lane) => updateSession(lane, {
      totalDistance: 0,
      elapsedMs: 0,
      laps: [],
      checkpoints: [],
      phase: 'running',
      ready: true
    })));
    await setCompetitionState({
      status: 'running',
      startedAt: serverTimestamp(),
      stoppedAt: null,
      elapsedMs: 0,
      distancePerLap: getDistanceStep(),
      durationMs: getDurationMs(),
      expectedLanes,
      updatedAt: serverTimestamp()
    });
    $('actionFeedback').textContent = 'Tiempo iniciado y sincronizado.';
  } catch (error) {
    console.error('No se pudo iniciar la prueba:', error);
    $('actionFeedback').textContent = `No se pudo iniciar: ${error.message || 'verifica Firebase y sus reglas.'}`;
  }
});

$('stopBtn').addEventListener('click', async () => {
  if (state.competition.status !== 'running') return;
  const elapsedMs = getElapsed();
  try {
    await Promise.all(getExpectedLanes().map((lane) => updateSession(lane, {
      ready: false,
      phase: 'finished'
    })));
    await setCompetitionState({
      ...state.competition,
      status: 'finished',
      stoppedAt: serverTimestamp(),
      elapsedMs,
      updatedAt: serverTimestamp()
    });
    $('actionFeedback').textContent = 'Tiempo detenido y sincronizado.';
  } catch (error) {
    console.error('No se pudo detener la prueba:', error);
    $('actionFeedback').textContent = `No se pudo detener: ${error.message || 'verifica Firebase y sus reglas.'}`;
  }
});

$('exportBtn').addEventListener('click', async () => {
  const eventSessions = getExpectedLanes().map(getSession).filter(Boolean);
  if (!eventSessions.length) {
    $('actionFeedback').textContent = 'No hay registros para exportar.';
    return;
  }

  try {
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
    const summary = eventSessions
      .slice()
      .sort((a, b) => Number(a.lane) - Number(b.lane))
      .map((session) => ({
        Carril: session.lane,
        Equipo: session.team || 'Equipo sin nombre',
        Juez: session.judge || 'Sin juez',
        Vueltas: Array.isArray(session.laps) ? session.laps.length : 0,
        'Distancia (m)': Number(session.totalDistance) || 0,
        'Tiempo oficial': formatTime(getElapsed()),
        'Último parcial': Array.isArray(session.laps) && session.laps.length
          ? formatTime(session.laps[session.laps.length - 1].splitMs)
          : ''
      }));
    const lapRows = eventSessions.flatMap((session) => {
      const checkpoints = Array.isArray(session.checkpoints)
        ? session.checkpoints
        : (Array.isArray(session.laps) ? session.laps : []).filter((lap) => Number(lap.distance) > 0 && Number(lap.distance) % 500 === 0);
      return checkpoints.map((checkpoint) => ({
        Carril: session.lane,
        Equipo: session.team || 'Equipo sin nombre',
        Juez: session.judge || 'Sin juez',
        'Hito (m)': checkpoint.distance,
        'Distancia al registrar (m)': checkpoint.registeredDistance ?? checkpoint.distance,
        'Tiempo acumulado': formatTime(checkpoint.elapsedMs),
        Fecha: checkpoint.timestamp || ''
      }));
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), 'Carriles');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lapRows), 'Hitos 500 m');
    XLSX.writeFile(workbook, 'registros-cronometraje.xlsx');
    $('actionFeedback').textContent = `Excel exportado: ${lapRows.length} hitos de 500 m.`;
  } catch (error) {
    console.error('No se pudo crear el archivo Excel:', error);
    $('actionFeedback').textContent = `No se pudo generar el Excel: ${error.message || 'revisa la conexión a internet.'}`;
  }
});

$('generateQrBtn').addEventListener('click', async () => {
  const assignedLane = Number($('assignedLane').value);
  if (!Number.isInteger(assignedLane) || assignedLane < 1 || assignedLane > 99) {
    $('qrMessage').textContent = 'Escribe un carril entre 1 y 99.';
    return;
  }

  const judgeUrl = new URL('./index.html', window.location.href);
  judgeUrl.searchParams.set('lane', String(assignedLane));
  try {
    const module = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm');
    const QRCode = module.default || module;
    await QRCode.toCanvas($('qrCanvas'), judgeUrl.href, { width: 256, margin: 1 });
    $('judgeQrLink').href = judgeUrl.href;
    $('judgeQrLink').textContent = judgeUrl.href;
    $('qrCopyFeedback').textContent = '';
    $('qrLaneLabel').textContent = `Carril ${assignedLane}`;
    $('qrMessage').textContent = '';
    $('qrDialog').showModal();
  } catch (error) {
    console.error('No se pudo generar el código QR:', error);
    $('qrMessage').textContent = `No se pudo generar el QR: ${error.message || 'revisa la conexión.'}`;
  }
});

$('closeQrBtn').addEventListener('click', () => $('qrDialog').close());
$('copyQrLinkBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('judgeQrLink').href);
    $('qrCopyFeedback').textContent = 'Enlace copiado.';
  } catch (error) {
    $('qrCopyFeedback').textContent = $('judgeQrLink').href;
  }
});

const persistConfiguration = async () => {
  if (!state.connected || state.competition.status === 'running') return;
  try {
    await setCompetitionState({
      ...state.competition,
      status: state.competition.status || 'ready',
      distancePerLap: getDistanceStep(),
      durationMs: getDurationMs(),
      expectedLanes: getExpectedLanes(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    $('actionFeedback').textContent = `No se guardó la configuración: ${error.message || 'revisa Firebase.'}`;
  }
};

$('distanceStep').addEventListener('change', () => {
  $('customStepWrap').hidden = $('distanceStep').value !== 'custom';
  renderTimer();
  persistConfiguration();
});
$('duration').addEventListener('change', () => {
  $('customDurationWrap').hidden = $('duration').value !== 'custom';
  renderTimer();
  persistConfiguration();
});
$('expectedLanes').addEventListener('input', () => {
  renderTable();
});
$('expectedLanes').addEventListener('change', () => {
  persistConfiguration();
});
$('customStep').addEventListener('change', () => {
  renderTimer();
  persistConfiguration();
});
$('customDuration').addEventListener('change', () => {
  renderTimer();
  persistConfiguration();
});

subscribeToServerOffset((offset) => {
  state.serverOffset = offset;
  renderTimer();
});
subscribeToConnection((connected) => {
  if (connected === null) {
    if (!state.connectionTimedOut) {
      state.connectionPending = true;
      renderReadiness();
    }
    return;
  }
  state.connectionPending = false;
  state.connectionTimedOut = false;
  state.connected = connected;
  state.connectionError = '';
  renderReadiness();
}, (error) => {
  console.error('Error de conexión con Firebase:', error);
  state.connectionPending = false;
  state.connectionTimedOut = false;
  state.connected = false;
  state.connectionError = error.message || '';
  renderReadiness();
});
setTimeout(() => {
  if (!state.connected && state.connectionPending) {
    state.connectionPending = false;
    state.connectionTimedOut = true;
    renderReadiness();
  }
}, 12000);
subscribeToCompetition((competition) => {
  state.competition = competition;
  if (Array.isArray(competition.expectedLanes) && document.activeElement !== $('expectedLanes')) {
    $('expectedLanes').value = competition.expectedLanes.join(', ');
  }
  if (competition.distancePerLap) {
    const distance = Number(competition.distancePerLap);
    const preset = [...$('distanceStep').options].some((option) => Number(option.value) === distance);
    $('distanceStep').value = preset ? String(distance) : 'custom';
    if (!preset) $('customStep').value = String(distance);
    $('customStepWrap').hidden = preset;
  }
  if (competition.durationMs) {
    const seconds = Number(competition.durationMs) / 1000;
    const preset = [...$('duration').options].some((option) => Number(option.value) === seconds);
    $('duration').value = preset ? String(seconds) : 'custom';
    if (!preset) $('customDuration').value = String(Math.max(1, Math.round(seconds / 60)));
    $('customDurationWrap').hidden = preset;
  }
  renderTimer();
}, (error) => {
  console.error('No se pudo leer el estado del evento:', error);
  state.connected = false;
  state.connectionError = error.message || '';
  renderReadiness();
});
subscribeToSessions((sessions) => {
  state.sessions = sessions;
  renderTable();
}, (error) => {
  console.error('No se pudieron leer las sesiones:', error);
  state.connected = false;
  state.connectionError = error.message || '';
  renderReadiness();
});

renderTimer();
renderTable();
