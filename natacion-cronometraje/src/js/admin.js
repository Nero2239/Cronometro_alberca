import { requireAuthentication } from './auth.js?v=2';
import {
  saveRace,
  serverTimestamp,
  setCompetitionState,
  subscribeToConnection,
  subscribeToCompetition,
  subscribeToServerOffset,
  subscribeToSessions,
  updateSession
} from './firebase.js?v=3';

await requireAuthentication();

const $ = (id) => document.getElementById(id);
const state = {
  competition: { status: 'ready' },
  sessions: [],
  serverOffset: 0,
  connected: false,
  connectionPending: true,
  connectionTimedOut: false,
  connectionError: '',
  rafId: null,
  startInProgress: false,
  stopInProgress: false,
  autoStopStartedAt: null,
  configurationControlsDirty: false,
  pendingConfiguration: null
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
  if ($('duration').value !== 'custom') return Number($('duration').value) * 1000;

  const hours = Number($('durationHours').value);
  const minutes = Number($('durationMinutes').value);
  const seconds = Number($('durationSeconds').value);
  if (![hours, minutes, seconds].every(Number.isInteger)
    || hours < 0 || hours > 24
    || minutes < 0 || minutes > 59
    || seconds < 0 || seconds > 59
    || (hours === 24 && (minutes !== 0 || seconds !== 0))) return null;

  const durationMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
  return durationMs > 0 && durationMs <= 86400000 ? durationMs : null;
};

const getDurationMode = () => $('duration').value === 'custom' ? 'custom' : 'preset';
const getStoredDurationMode = (durationMs) => [...$('duration').options]
  .some((option) => Number(option.value) * 1000 === Number(durationMs))
  ? 'preset'
  : 'custom';

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

const showConfirmation = (dialogId) => new Promise((resolve) => {
  const dialog = $(dialogId);
  if (dialog.open) {
    resolve(false);
    return;
  }
  const form = dialog.querySelector('form');
  const cleanup = () => {
    form.removeEventListener('submit', onSubmit);
    dialog.removeEventListener('cancel', onCancel);
  };
  const onSubmit = (event) => {
    event.preventDefault();
    const confirmed = event.submitter?.value === 'confirm';
    cleanup();
    dialog.close(confirmed ? 'confirm' : 'cancel');
    resolve(confirmed);
  };
  const onCancel = () => {
    cleanup();
    resolve(false);
  };
  form.addEventListener('submit', onSubmit);
  dialog.addEventListener('cancel', onCancel);
  dialog.showModal();
});

const renderAssignedLaneOptions = () => {
  const { lanes, error } = parseExpectedLanes();
  const select = $('assignedLane');
  const selectedLane = select.value;
  select.replaceChildren();

  if (error || !lanes.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = error ? 'Corrige los carriles requeridos' : 'Agrega carriles requeridos';
    select.append(option);
    select.disabled = true;
    $('generateQrBtn').disabled = true;
    return;
  }

  for (const lane of lanes) {
    const option = document.createElement('option');
    option.value = lane;
    option.textContent = `Carril ${lane}`;
    select.append(option);
  }

  select.value = lanes.includes(selectedLane) ? selectedLane : lanes[0];
  select.disabled = false;
  $('generateQrBtn').disabled = false;
};

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
    const elapsed = Math.max(0, Date.now() + state.serverOffset - state.competition.startedAt);
    const duration = Number(state.competition.durationMs) || getDurationMs();
    return duration ? Math.min(elapsed, duration) : elapsed;
  }
  return Math.max(0, Number(state.competition.elapsedMs) || 0);
};

const renderTimer = () => {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  const running = state.competition.status === 'running';
  const elapsed = getElapsed();
  const selectedDuration = getDurationMs();
  const configuredDuration = Number(state.competition.durationMs) || selectedDuration;
  const durationMs = running ? configuredDuration || 1800000 : selectedDuration || configuredDuration || 1800000;
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
    ? remaining === 0 ? 'Tiempo cumplido; detención automática' : 'La prueba está sincronizada con todos los dispositivos'
    : state.competition.status === 'finished' ? 'Tiempo oficial detenido' : 'Listo para iniciar';
  renderReadiness();
  $('stopBtn').disabled = !running;
  $('resetBtn').disabled = !state.connected || state.connectionPending || state.stopInProgress;
  $('customStep').disabled = $('distanceStep').value !== 'custom';
  for (const id of ['durationHours', 'durationMinutes', 'durationSeconds']) {
    $(id).disabled = $('duration').value !== 'custom';
  }
  $('durationHint').hidden = $('duration').value !== 'custom' || selectedDuration !== null;
  $('durationHint').classList.toggle('invalid', !$('durationHint').hidden);

  if (running && remaining === 0) {
    const startedAt = Number(state.competition.startedAt);
    if (startedAt && state.autoStopStartedAt !== startedAt) {
      state.autoStopStartedAt = startedAt;
      stopRunningCompetition(true);
    }
  }

  if (running) state.rafId = requestAnimationFrame(renderTimer);
};

const renderReadiness = () => {
  const { lanes: expectedLanes, error } = parseExpectedLanes();
  const readyCount = getReadyCount();
  const connectedCount = expectedLanes.filter((lane) => isSessionConnected(getSession(lane))).length;
  const validDuration = getDurationMs() !== null;
  const allReady = state.connected && !error && validDuration && expectedLanes.length > 0 && readyCount === expectedLanes.length;
  $('laneListHint').textContent = error || 'Usa comas o rangos. La tabla mostrará solo estos carriles.';
  $('laneListHint').classList.toggle('invalid', Boolean(error));
  $('readinessSummary').textContent = error
    ? error
    : `Jueces conectados: ${connectedCount}/${expectedLanes.length} · preparados: ${readyCount}/${expectedLanes.length}`;
  $('startBtn').disabled = state.competition.status === 'running' || state.startInProgress || !allReady;

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
  renderAssignedLaneOptions();
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
  if (state.competition.status === 'running' || state.startInProgress) return;
  const expectedLanes = getExpectedLanes();
  if (!state.connected || !expectedLanes.length || getReadyCount() !== expectedLanes.length) return;
  const hasPreviousLaps = expectedLanes.some((lane) => (getSession(lane)?.laps?.length || 0) > 0);
  if (getDurationMs() === null) {
    $('durationHint').hidden = false;
    $('durationHint').classList.add('invalid');
    $('actionFeedback').textContent = 'La duración debe estar entre 00:00:01 y 24:00:00.';
    return;
  }
  state.startInProgress = true;
  renderReadiness();
  try {
    if (hasPreviousLaps && !await showConfirmation('startConfirmDialog')) return;
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
      durationMode: getDurationMode(),
      expectedLanes,
      updatedAt: serverTimestamp()
    });
    $('actionFeedback').textContent = 'Tiempo iniciado y sincronizado.';
  } catch (error) {
    console.error('No se pudo iniciar la prueba:', error);
    $('actionFeedback').textContent = `No se pudo iniciar: ${error.message || 'verifica Firebase y sus reglas.'}`;
  } finally {
    state.startInProgress = false;
    renderReadiness();
  }
});

const stopRunningCompetition = async (automatic = false) => {
  if (state.competition.status !== 'running' || state.stopInProgress) return;
  state.stopInProgress = true;
  $('stopBtn').disabled = true;
  $('resetBtn').disabled = true;
  const elapsedMs = getElapsed();
  try {
    await Promise.all(getExpectedLanes().map((lane) => updateSession(lane, {
      ready: false,
      phase: 'finished'
    })));
    await setCompetitionState({
      status: 'finished',
      stoppedAt: serverTimestamp(),
      elapsedMs,
      updatedAt: serverTimestamp()
    });
    $('actionFeedback').textContent = automatic
      ? 'Duración cumplida; tiempo detenido automáticamente.'
      : 'Tiempo detenido y sincronizado.';
  } catch (error) {
    console.error('No se pudo detener la prueba:', error);
    $('actionFeedback').textContent = `No se pudo detener: ${error.message || 'verifica Firebase y sus reglas.'}`;
  } finally {
    state.stopInProgress = false;
    renderTimer();
  }
};

$('stopBtn').addEventListener('click', () => stopRunningCompetition());

$('resetBtn').addEventListener('click', async () => {
  if (!state.connected || state.stopInProgress) return;
  $('resetBtn').disabled = true;
  if (!await showConfirmation('resetConfirmDialog')) {
    renderTimer();
    return;
  }

  state.stopInProgress = true;
  renderTimer();
  const expectedLanes = getExpectedLanes();
  try {
    let saveMessage = '';
    if ($('saveRaceBeforeReset').checked) {
      const eventSessions = expectedLanes.map((lane) => getSession(lane) || {
        lane,
        team: '',
        judge: '',
        totalDistance: 0,
        elapsedMs: 0,
        laps: [],
        checkpoints: [],
        phase: 'finished'
      });
      const hasRaceData = eventSessions.some((session) => (
        (Array.isArray(session.laps) && session.laps.length > 0)
        || (Number(session.totalDistance) || 0) > 0
        || Boolean(session.team)
        || Boolean(session.judge)
      ));
      if (hasRaceData) {
        await saveRace({
          status: state.competition.status,
          durationMs: Number(state.competition.durationMs) || getDurationMs(),
          durationMode: state.competition.durationMode || getDurationMode(),
          distancePerLap: Number(state.competition.distancePerLap) || getDistanceStep(),
          elapsedMs: getElapsed(),
          expectedLanes
        }, eventSessions);
        saveMessage = ' Carrera guardada en el historial.';
      } else {
        saveMessage = ' No había registros para guardar.';
      }
    }
    await Promise.all(expectedLanes.map((lane) => updateSession(lane, {
      totalDistance: 0,
      elapsedMs: 0,
      laps: [],
      checkpoints: [],
      phase: 'finished',
      ready: false
    })));
    await setCompetitionState({
      status: 'ready',
      startedAt: null,
      stoppedAt: serverTimestamp(),
      elapsedMs: 0,
      expectedLanes,
      updatedAt: serverTimestamp()
    });
    state.autoStopStartedAt = null;
    $('actionFeedback').textContent = `Prueba reiniciada; vueltas borradas y jueces pendientes de preparación.${saveMessage}`;
  } catch (error) {
    console.error('No se pudo reiniciar la prueba:', error);
    $('actionFeedback').textContent = `No se pudo reiniciar: ${error.message || 'verifica Firebase y sus reglas.'}`;
  } finally {
    state.stopInProgress = false;
    renderTimer();
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
  const assignedLane = $('assignedLane').value;
  if (!getExpectedLanes().includes(assignedLane)) {
    $('qrMessage').textContent = 'Selecciona un carril de la lista de carriles requeridos.';
    return;
  }

  const judgeUrl = new URL('./judge.html', window.location.href);
  judgeUrl.searchParams.set('lane', assignedLane);
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

let durationSaveTimeout = null;
let configurationSaveQueue = Promise.resolve();
const markConfigurationControlsDirty = () => {
  state.configurationControlsDirty = true;
};

const persistConfiguration = async () => {
  if (!state.connected) return;
  if (getDurationMs() === null) {
    $('durationHint').hidden = false;
    $('durationHint').classList.add('invalid');
    $('actionFeedback').textContent = 'La duración debe estar entre 00:00:01 y 24:00:00.';
    return;
  }
  if ($('actionFeedback').textContent.startsWith('La duración debe estar')) {
    $('actionFeedback').textContent = '';
  }
  const configuration = {
    status: state.competition.status || 'ready',
    distancePerLap: getDistanceStep(),
    durationMs: getDurationMs(),
    durationMode: getDurationMode(),
    expectedLanes: getExpectedLanes(),
    updatedAt: serverTimestamp()
  };
  state.pendingConfiguration = {
    distancePerLap: configuration.distancePerLap,
    durationMs: configuration.durationMs,
    durationMode: configuration.durationMode,
    expectedLanes: configuration.expectedLanes
  };
  const save = configurationSaveQueue.then(
    () => setCompetitionState(configuration),
    () => setCompetitionState(configuration)
  );
  configurationSaveQueue = save;
  try {
    await save;
  } catch (error) {
    $('actionFeedback').textContent = `No se guardó la configuración: ${error.message || 'revisa Firebase.'}`;
  }
};

const scheduleDurationConfigurationSave = () => {
  if (durationSaveTimeout) clearTimeout(durationSaveTimeout);
  durationSaveTimeout = setTimeout(() => {
    durationSaveTimeout = null;
    persistConfiguration();
  }, 500);
};

$('distanceStep').addEventListener('change', () => {
  $('customStepWrap').hidden = $('distanceStep').value !== 'custom';
  markConfigurationControlsDirty();
  renderTimer();
  persistConfiguration();
});
$('duration').addEventListener('change', () => {
  $('customDurationWrap').hidden = $('duration').value !== 'custom';
  $('durationHint').hidden = $('duration').value !== 'custom';
  markConfigurationControlsDirty();
  renderTimer();
  persistConfiguration();
});
$('expectedLanes').addEventListener('input', () => {
  markConfigurationControlsDirty();
  renderTable();
});
$('expectedLanes').addEventListener('change', () => {
  persistConfiguration();
});
$('customStep').addEventListener('change', () => {
  markConfigurationControlsDirty();
  renderTimer();
  persistConfiguration();
});
for (const id of ['durationHours', 'durationMinutes', 'durationSeconds']) {
  $(id).addEventListener('input', () => {
    markConfigurationControlsDirty();
    renderTimer();
    scheduleDurationConfigurationSave();
  });
  $(id).addEventListener('change', renderTimer);
}
$('customDurationWrap').addEventListener('focusout', (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    if (durationSaveTimeout) clearTimeout(durationSaveTimeout);
    durationSaveTimeout = null;
    persistConfiguration();
  }
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
  if (!connected) state.autoStopStartedAt = null;
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
subscribeToCompetition((competition, snapshotMetadata) => {
  state.competition = competition;
  if (competition.durationMs) {
    const seconds = Number(competition.durationMs) / 1000;
    const storedDurationMode = competition.durationMode === 'custom' || competition.durationMode === 'preset'
      ? competition.durationMode
      : getStoredDurationMode(competition.durationMs);
    const pendingConfiguration = state.pendingConfiguration;
    const matchesPendingConfiguration = pendingConfiguration
      && Number(competition.durationMs) === pendingConfiguration.durationMs
      && storedDurationMode === pendingConfiguration.durationMode
      && Number(competition.distancePerLap) === pendingConfiguration.distancePerLap
      && JSON.stringify(competition.expectedLanes || []) === JSON.stringify(pendingConfiguration.expectedLanes)
      && snapshotMetadata?.fromCache === false
      && snapshotMetadata?.hasPendingWrites === false;
    if (matchesPendingConfiguration) {
      state.configurationControlsDirty = false;
      state.pendingConfiguration = null;
    }
    if (!state.configurationControlsDirty) {
      if (Array.isArray(competition.expectedLanes) && document.activeElement !== $('expectedLanes')) {
        $('expectedLanes').value = competition.expectedLanes.join(', ');
      }
      if (competition.distancePerLap) {
        const distance = Number(competition.distancePerLap);
        const distancePreset = [...$('distanceStep').options].some((option) => Number(option.value) === distance);
        $('distanceStep').value = distancePreset ? String(distance) : 'custom';
        if (!distancePreset) $('customStep').value = String(distance);
        $('customStepWrap').hidden = distancePreset;
      }
      const durationPreset = storedDurationMode === 'preset'
        && [...$('duration').options].some((option) => Number(option.value) === seconds);
      $('duration').value = durationPreset ? String(seconds) : 'custom';
      if (!['durationHours', 'durationMinutes', 'durationSeconds'].includes(document.activeElement?.id)) {
        $('durationHours').value = String(Math.floor(seconds / 3600));
        $('durationMinutes').value = String(Math.floor((seconds % 3600) / 60));
        $('durationSeconds').value = String(Math.floor(seconds % 60));
      }
      $('customDurationWrap').hidden = durationPreset;
      $('durationHint').hidden = durationPreset || getDurationMs() !== null;
    }
  } else if (!state.configurationControlsDirty) {
    if (Array.isArray(competition.expectedLanes) && document.activeElement !== $('expectedLanes')) {
      $('expectedLanes').value = competition.expectedLanes.join(', ');
    }
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
