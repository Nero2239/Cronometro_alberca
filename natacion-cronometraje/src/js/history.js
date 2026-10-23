import { requireAuthentication } from './auth.js?v=2';
import { getRaceLanes, listRaces } from './firebase.js?v=3';

await requireAuthentication();

const $ = (id) => document.getElementById(id);
const state = { races: [] };

const formatTime = (ms) => {
  const safe = Math.max(0, Number(ms) || 0);
  const totalHundreds = Math.floor(safe / 10);
  const minutes = Math.floor(totalHundreds / 6000);
  const seconds = Math.floor((totalHundreds / 100) % 60);
  const hundredths = totalHundreds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

const raceDate = (value) => {
  if (!value || typeof value.toDate !== 'function') return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(value.toDate());
};

const renderLanes = (container, lanes) => {
  const sortedLanes = [...lanes].sort((a, b) => Number(a.lane) - Number(b.lane));
  if (!sortedLanes.length) {
    container.textContent = 'Esta carrera no tiene carriles registrados.';
    container.classList.add('race-empty');
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Carril</th><th>Equipo</th><th>Juez</th><th>Distancia</th><th>Tiempo</th><th>Vueltas</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const lane of sortedLanes) {
    const row = document.createElement('tr');
    for (const value of [
      lane.lane,
      lane.team || '—',
      lane.judge || '—',
      `${Number(lane.totalDistance) || 0} m`,
      lane.laps?.length ? formatTime(lane.elapsedMs) : '—',
      String(Array.isArray(lane.laps) ? lane.laps.length : 0)
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  container.replaceChildren(table);

  for (const lane of sortedLanes) {
    if (!Array.isArray(lane.laps) || !lane.laps.length) continue;
    const lapSummary = document.createElement('p');
    lapSummary.className = 'race-laps';
    lapSummary.textContent = `Carril ${lane.lane}: ${lane.laps.map((lap) => `${Number(lap.distance) || 0} m · ${formatTime(lap.elapsedMs)}`).join('  |  ')}`;
    container.append(lapSummary);
  }
};

const renderRaces = () => {
  const list = $('historyList');
  list.replaceChildren();
  if (!state.races.length) {
    $('historyFeedback').textContent = 'Todavía no hay carreras guardadas.';
    return;
  }

  $('historyFeedback').textContent = `${state.races.length} carrera${state.races.length === 1 ? '' : 's'} guardada${state.races.length === 1 ? '' : 's'}.`;
  for (const race of state.races) {
    const entry = document.createElement('article');
    entry.className = 'race-entry';
    const toggle = document.createElement('button');
    toggle.className = 'race-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    const date = document.createElement('span');
    date.className = 'race-date';
    date.textContent = raceDate(race.createdAt);
    const summary = document.createElement('span');
    summary.className = 'race-summary';
    summary.textContent = `${Number(race.distancePerLap) || 0} m por vuelta · ${race.expectedLanes?.length || 0} carriles · Tiempo ${formatTime(race.elapsedMs)}`;
    const expand = document.createElement('span');
    expand.className = 'race-expand';
    expand.textContent = '+';
    toggle.append(date, summary, expand);
    const detail = document.createElement('div');
    detail.className = 'race-lanes';
    detail.hidden = true;
    let loading = false;
    toggle.addEventListener('click', async () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!isExpanded));
      detail.hidden = isExpanded;
      expand.textContent = isExpanded ? '+' : '−';
      if (isExpanded || loading || detail.dataset.loaded === 'true') return;
      loading = true;
      detail.textContent = 'Cargando registros...';
      try {
        renderLanes(detail, await getRaceLanes(race.id));
        detail.dataset.loaded = 'true';
      } catch (error) {
        console.error('No se pudieron cargar los registros de la carrera:', error);
        detail.textContent = 'No se pudieron cargar los carriles. Revisa la conexión e inténtalo de nuevo.';
      } finally {
        loading = false;
      }
    });
    entry.append(toggle, detail);
    list.append(entry);
  }
};

const loadHistory = async () => {
  $('historyFeedback').textContent = 'Cargando historial...';
  $('historyList').replaceChildren();
  try {
    state.races = await listRaces($('sortDirection').value);
    renderRaces();
  } catch (error) {
    console.error('No se pudo cargar el historial de carreras:', error);
    $('historyFeedback').textContent = 'No se pudo cargar el historial. Revisa la conexión y los permisos de Firestore.';
  }
};

$('sortDirection').addEventListener('change', loadHistory);
loadHistory();
