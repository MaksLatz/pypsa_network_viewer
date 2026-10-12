// Network Components tab: graph cards, one after another. Each card has its own Component / Data type /
// Time series selection, filters, unit and CSV download, and shows a static table, the global constraints
// or a timeseries plot. The time axes of all timeseries plots are zoomed together.

const HYDRO_TOGGLE_CLASSES = ['Bus', 'Link'];
// Cards in display order. Card settings (saved in the page link):
// - type / data / ts: the selection; showHydro: { componentType: true } shows the hydro buses / links;
// - units: chosen prefix per kind of unit, e.g. { power: 'G' }; threshold: minimum peak |value| ('' = off).
// Each card's filters are stored under its own key (cardFilterKey), so two cards never share filters.
const componentsCards = [];
let componentsCardSeq = 0;
const cardFilterKey = (card, componentType) => `card${card.id}|${componentType}`;

const titleCase = s => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

function componentTypeOptions() {
    // Global constraints get their own entry (a formatted table), not the generic component one
    const opts = Object.keys(networkData.components).filter(c => c !== 'global_constraints')
        .map(c => `<option value="${escapeHtml(c)}">${escapeHtml(titleCase(c))}</option>`);
    if (networkData.summary.global_constraints) opts.push('<option value="global_constraints">Global Constraints</option>');
    return '<option value="">Select component type...</option>' + opts.join('');
}

// Add a card (settings from `init`, e.g. a restored page link) at the end of the tab; returns it
function addComponentsCard(init = {}) {
    const id = init.id || ++componentsCardSeq;
    componentsCardSeq = Math.max(componentsCardSeq, id);
    const card = {
        id, type: '', data: '', ts: '', showHydro: {}, units: {}, threshold: '',
        ...init
    };
    const root = document.createElement('div');
    root.className = 'graph-card';
    root.id = `graphCard${id}`;
    root.innerHTML = `
        <div class="graph-card-bar">
            <div class="controls-section graph-card-selects">
                <div class="control-group">
                    <label class="control-label">Component Type</label>
                    <select data-role="type">${componentTypeOptions()}</select>
                </div>
                <div class="control-group">
                    <label class="control-label">Data Type</label>
                    <select data-role="data">
                        <option value="">Select data type...</option>
                        <option value="static">Static Data</option>
                        <option value="timeseries">Time Series</option>
                    </select>
                </div>
                <div class="control-group">
                    <label class="control-label">Time Series</label>
                    <select data-role="ts"><option value="">Select timeseries...</option></select>
                </div>
            </div>
            <button type="button" class="link-btn graph-card-remove" title="Remove this graph">✕ Remove</button>
        </div>
        <div class="graph-card-info"></div>
        <div class="graph-card-controls"></div>
        <div class="plot-container graph-card-plot-wrap"><div class="graph-card-plot"></div></div>`;
    document.getElementById('componentsCards').appendChild(root);
    card.root = root;
    card.el = {
        type: root.querySelector('[data-role=type]'),
        data: root.querySelector('[data-role=data]'),
        ts: root.querySelector('[data-role=ts]'),
        info: root.querySelector('.graph-card-info'),
        controls: root.querySelector('.graph-card-controls'),
        plotWrap: root.querySelector('.graph-card-plot-wrap'),
        plot: root.querySelector('.graph-card-plot')
    };
    componentsCards.push(card);
    syncCardSelects(card);

    card.el.type.addEventListener('change', () => { card.type = card.el.type.value; syncCardSelects(card); renderCard(card); });
    card.el.data.addEventListener('change', () => { card.data = card.el.data.value; syncCardSelects(card); renderCard(card); });
    card.el.ts.addEventListener('change', () => { card.ts = card.el.ts.value; renderCard(card); });
    root.querySelector('.graph-card-remove').addEventListener('click', () => removeComponentsCard(card));
    updateRemoveButtons();
    return card;
}

function removeComponentsCard(card) {
    if (componentsCards.length <= 1) return;
    if (card.el.plot.data) Plotly.purge(card.el.plot);
    componentsCards.splice(componentsCards.indexOf(card), 1);
    Object.keys(activeFilters).filter(k => k.startsWith(`card${card.id}|`)).forEach(k => delete activeFilters[k]);
    card.root.remove();
    updateRemoveButtons();
}

function updateRemoveButtons() {
    componentsCards.forEach(c => { c.root.querySelector('.graph-card-remove').style.display = componentsCards.length > 1 ? '' : 'none'; });
}

// Make the dropdowns show the card's selection. The data type (and timeseries, when available) is kept
// when switching component; Global Constraints has no data type.
function syncCardSelects(card) {
    const { type, data, ts } = card.el;
    if (![...type.options].some(o => o.value === card.type)) card.type = '';
    type.value = card.type;
    const generic = card.type && card.type !== 'global_constraints';
    data.disabled = !generic;
    data.value = card.data;
    const names = generic ? Object.keys(networkData.components[card.type].timeseries) : [];
    ts.innerHTML = `<option value="">${!generic || names.length ? 'Select timeseries...' : '(no timeseries available)'}</option>` +
        names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    if (!names.includes(card.ts)) card.ts = '';
    ts.value = card.ts;
    ts.disabled = !generic || card.data !== 'timeseries';
}

// Draw every card (at least one), e.g. when the tab opens or the investment period changes
function renderComponentsView() {
    if (!componentsCards.length) addComponentsCard();
    componentsCards.forEach(renderCard);
}

function addGraphButtonClicked() {
    const card = addComponentsCard();
    renderCard(card);
    card.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show whatever the card's selection allows
function renderCard(card) {
    const { type, data, ts } = card;
    const hint = (title, text) => {
        clearCardPlot(card);
        card.el.controls.innerHTML = '';
        card.el.info.innerHTML = `<div class="info-panel"><h3>${title}</h3>${text}</div>`;
    };
    try {
        if (!type) {
            hint('Instructions', `<ol class="instructions">
                <li>Choose a <strong>Component Type</strong> (Buses, Generators, … or Global Constraints).</li>
                <li>Choose <strong>Static Data</strong> for the attribute table, or <strong>Time Series</strong> for plots.</li>
                <li>For Time Series, choose the attribute to plot. The view updates as soon as the selection is complete.</li>
                <li><strong>+ Add graph</strong> (below) adds another graph, e.g. bus prices under generator output; zooming the time axis of one graph zooms them all.</li>
            </ol>`);
        } else if (type === 'global_constraints') {
            displayGlobalConstraints(card);
        } else if (data === 'static') {
            displayStaticData(card, type);
        } else if (data === 'timeseries') {
            if (ts) {
                displayTimeseriesData(card, type, ts);
            } else if (Object.keys(networkData.components[type].timeseries).length === 0) {
                hint('No time series', `<p>${escapeHtml(type)} has no timeseries data. Choose Static Data instead.</p>`);
            } else {
                hint('Select a time series', '<p>Choose the attribute to plot in the <strong>Time Series</strong> dropdown.</p>');
            }
        } else {
            hint('Select a data type', '<p>Choose <strong>Static Data</strong> or <strong>Time Series</strong>.</p>');
        }
    } catch (error) {
        console.error(error);
        card.el.info.innerHTML = `<div class="error-panel"><strong>Error:</strong> ${escapeHtml(error.message)}</div>`;
    }
}

// Hide the card's plot (a table or a message is shown instead). The plot is kept, not purged: purging
// right after a redraw breaks Plotly's pending margin updates; the next timeseries redraws it in place.
function clearCardPlot(card) {
    card.el.plotWrap.style.display = 'none';
}

// CSV button for a card; makeExport returns { fileName, header, rows } and is only called on click
function cardCsvButton(what) {
    return `<button type="button" class="toggle-btn card-download" title="Download ${escapeHtml(what)} as CSV">⬇ Download CSV</button>`;
}
function bindCardCsv(container, makeExport) {
    container.querySelector('.card-download').addEventListener('click', () => {
        const { fileName, header, rows } = makeExport();
        saveCsv(fileName, header, rows);
    });
}

function displayGlobalConstraints(card) {
    const data = networkData.summary.global_constraints;
    clearCardPlot(card);
    card.el.controls.innerHTML = '';
    if (!data || data.length === 0) {
        card.el.info.innerHTML = '<div class="error-panel"><strong>No global constraints available</strong></div>';
        return;
    }
    const columns = Object.keys(data[0]);
    let html = `<div class="info-panel"><h3>Global Constraints</h3><p>Showing ${data.length} constraint(s)</p></div>
        <div class="unit-bar">${cardCsvButton('the global constraints table')}</div>
        <div class="data-table"><table><thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
    data.forEach(row => {
        html += '<tr>' + columns.map(c => `<td>${row[c] ?? 'N/A'}</td>`).join('') + '</tr>';
    });
    card.el.info.innerHTML = html + '</tbody></table></div>';
    bindCardCsv(card.el.info, () => ({
        fileName: 'global_constraints.csv',
        header: columns,
        rows: data.map(row => columns.map(c => row[c] ?? ''))
    }));
}

function displayStaticData(card, componentType) {
    const data = networkData.components[componentType].static;
    clearCardPlot(card);
    card.el.controls.innerHTML = '';
    if (!data || Object.keys(data).length === 0) {
        card.el.info.innerHTML = `<div class="error-panel"><strong>No static data available for ${componentType}</strong></div>`;
        return;
    }
    const columns = Object.keys(data);
    const indices = Object.keys(data[columns[0]] || {});
    let html = `<div class="info-panel"><h3>${titleCase(componentType)} - Static Data</h3>
        <p>Showing ${indices.length} components with ${columns.length} properties</p></div>
        <div class="unit-bar">${cardCsvButton('this static data table')}</div>
        <div class="data-table"><table><thead><tr><th>Component</th>
        ${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
    indices.forEach(idx => {
        html += `<tr><td><strong>${idx}</strong></td>` +
            columns.map(c => `<td>${data[c][idx] ?? 'N/A'}</td>`).join('') + '</tr>';
    });
    card.el.info.innerHTML = html + '</tbody></table></div>';
    bindCardCsv(card.el.info, () => ({
        fileName: `${componentType}_static.csv`,
        header: ['Component', ...columns],
        rows: indices.map(idx => [idx, ...columns.map(c => data[c][idx] ?? '')])
    }));
}

function displayTimeseriesData(card, componentType, timeseriesName) {
    const data = networkData.components[componentType].timeseries[timeseriesName];
    if (!data || Object.keys(data.data).length === 0) {
        clearCardPlot(card);
        card.el.controls.innerHTML = '';
        card.el.info.innerHTML = `<div class="error-panel"><strong>No timeseries data for ${componentType} - ${timeseriesName}</strong></div>`;
        return;
    }

    let { timeIndex, timeStrings, seriesData, periodLabel } = applyPeriodFilter(data.time_index, data.data);
    const rerender = () => renderCard(card);
    const cls = getComponentClass(componentType);
    const filterKey = cardFilterKey(card, componentType);

    // Hydro buses (Buses) / links touching a hydro bus (Links): hidden unless the toggle is on.
    // Applied first, so the filters below only offer what can be shown.
    let hydroCount = 0;
    if (HYDRO_TOGGLE_CLASSES.includes(cls)) {
        const isHydro = hydroSeriesTest(componentType, cls);
        hydroCount = Object.keys(seriesData).filter(isHydro).length;
        if (!card.showHydro[componentType]) {
            seriesData = Object.fromEntries(Object.entries(seriesData).filter(([n]) => !isHydro(n)));
        }
    }

    // Attribute filters (carrier / type / bus for generators, bus0 / bus1 for links, node for buses / stores),
    // then name(s): each filter only offers what remains after the ones before it
    const filterCfg = getFilterConfig(componentType);
    const totalSeries = Object.keys(data.data).length;
    let filterValues = null;
    if (filterCfg) {
        filterValues = cascadeFilterValues(filterKey, componentType, filterCfg, Object.keys(seriesData));
        seriesData = applyAttributeFilters(filterKey, componentType, filterCfg, seriesData);
    }

    // Unit: MW / MWh / <currency>/MWh can be converted; anything else is shown as exported
    const unit = parseUnit(data.unit);
    const prefix = unit ? card.units[unit.kind] || unit.prefix : null;
    const factor = unitFactor(unit, prefix);
    const shownUnit = unit ? data.unit.replace(unit.match, unitLabel(unit, prefix)) : (data.unit || 'Value');

    // Threshold: keep the series whose peak |value| (shown period, shown unit) reaches it
    const threshold = card.threshold === '' ? null : Number(card.threshold);
    if (threshold !== null && Number.isFinite(threshold)) {
        seriesData = Object.fromEntries(Object.entries(seriesData).filter(([, values]) =>
            values.some(v => typeof v === 'number' && Math.abs(v * factor) >= threshold)));
    }
    const shownSeries = Object.keys(seriesData).length;

    const hydroLabel = cls === 'Link' ? 'hydro links' : 'hydro buses';
    const hydroButton = hydroCount
        ? `<div class="control-group"><button type="button" class="toggle-btn${card.showHydro[componentType] ? ' active' : ''}" data-card-action="hydro"
              title="Show or hide the ${hydroLabel} (names ending in ${escapeHtml((networkData.hydro_suffixes || []).join(', '))})">
              ${card.showHydro[componentType] ? 'Shown' : 'Hidden'}: ${hydroCount} ${hydroLabel}</button></div>`
        : '';
    const thresholdInput = `<div class="control-group threshold-group" title="Keep only the series whose largest absolute value (in the shown period and unit) reaches this value; empty = no threshold">
        <label class="control-label">Peak |value| ≥</label>
        <div class="threshold-input">
            <input type="number" step="any" data-card-action="threshold" value="${escapeHtml(card.threshold)}" placeholder="no threshold">
            <span>${escapeHtml(shownUnit)}</span>
        </div>
    </div>`;
    const filterBar = renderFilterBar(filterKey, filterValues || [], totalSeries, shownSeries,
        { id: `cardFilters${card.id}`, note: FILTER_NOTES[cls], extraHtml: thresholdInput + hydroButton });

    const unitChoices = unit ? UNIT_CHOICES[unit.kind].map(p => [p, unitLabel(unit, p)]) : [['', 'n/a']];
    const unitBar = `<div class="unit-bar">
        ${cardCsvButton('the plotted series (current filters, period and unit)')}
        <div class="unit-select" title="${unit ? '' : 'Only MW, MWh and price (per MWh) values can be converted'}">
            <label class="control-label">Unit</label>
            <div class="button-group">${optionButtons(`cardUnit${card.id}`, unitChoices, prefix || '', !unit)}</div>
        </div>
    </div>`;

    card.el.info.innerHTML = `
        <div class="info-panel">
            <h3>${titleCase(componentType)} - ${timeseriesName}${periodLabel}</h3>
            <p><strong>Time Range:</strong> ${data.time_range.start} to ${data.time_range.end} ·
               <strong>Series:</strong> ${shownSeries} of ${totalSeries} with ${timeIndex.length} time steps shown</p>
        </div>`;
    card.el.controls.innerHTML = filterBar + (shownSeries === 0
        ? '<div class="error-panel"><strong>No series match the selected filters.</strong></div>' : unitBar);

    bindFilterBar(document.getElementById(`cardFilters${card.id}`), filterKey, rerender, () => { card.threshold = ''; });
    const controls = card.el.controls;
    const hydroToggle = controls.querySelector('[data-card-action=hydro]');
    if (hydroToggle) hydroToggle.addEventListener('click', () => {
        card.showHydro[componentType] = !card.showHydro[componentType];
        rerender();
    });
    controls.querySelector('[data-card-action=threshold]').addEventListener('change', function() {
        card.threshold = this.value.trim();
        rerender();
    });
    if (shownSeries === 0) {
        clearCardPlot(card);
        return;
    }
    controls.querySelectorAll(`[data-option=cardUnit${card.id}]`).forEach(btn => btn.addEventListener('click', function() {
        card.units[unit.kind] = this.dataset.value;
        rerender();
    }));

    const names = Object.keys(seriesData);
    const scaled = Object.fromEntries(names.map(n => [n, factor === 1 ? seriesData[n]
        : seriesData[n].map(v => typeof v === 'number' ? v * factor : v)]));
    const period = slug(periodLabel);
    bindCardCsv(controls, () => ({
        fileName: `${componentType}_${slug(timeseriesName)}${period ? '_' + period : ''}.csv`,
        header: ['snapshot', ...names.map(n => n + (shownUnit !== 'Value' ? ` [${shownUnit}]` : ''))],
        rows: timeStrings.map((t, i) => [t, ...names.map(n => scaled[n][i])])
    }));

    // Generators and storage are coloured by their carrier's static colour (when defined)
    const carrierCol = CARRIER_COLORED_CLASSES.includes(cls)
        ? networkData.components[componentType].static.carrier : null;
    const colors = networkData.carrier_colors || {};
    const traces = names.map(name => {
        const t = { x: timeIndex, y: scaled[name], type: 'scatter', mode: 'lines', name, line: { width: 2 } };
        const carrier = carrierCol ? carrierCol[name] : undefined;
        if (carrier && colors[carrier]) t.line.color = colors[carrier];
        return t;
    });

    // The plot element persists between redraws: filter, threshold and unit changes keep the zoom
    // (x via uirevision; y rescaled on a unit change); a new component / attribute starts unzoomed
    card.el.plotWrap.style.display = '';
    const view = `${componentType}|${timeseriesName}|${periodLabel}`;
    Plotly.react(card.el.plot, traces, {
        title: `${componentType} - ${timeseriesName}${periodLabel}`,
        xaxis: { title: 'Time', type: 'date', uirevision: view },
        yaxis: { title: shownUnit, ...yAxisKeepingZoom(card.el.plot, view, shownUnit, factor) },
        hovermode: 'x unified',
        hoverlabel: { namelength: -1 },  // full series names (Plotly cuts them at 15 characters by default)
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
        margin: { l: 80, r: 80, t: 80, b: 120 },
        uirevision: view
    }, { responsive: true, displayModeBar: true, displaylogo: false });
    if (!card.el.plot.__timeSync) {
        card.el.plot.__timeSync = true;
        card.el.plot.on('plotly_relayout', ev => syncTimeAxes(card.el.plot, ev));
    }
}

// Zooming / panning the time axis of one timeseries plot applies the same time range to the others
let syncingTimeAxes = false;
function syncTimeAxes(source, ev) {
    if (syncingTimeAxes) return;
    let update = null;
    if (ev['xaxis.autorange']) update = { 'xaxis.autorange': true };
    else if (ev['xaxis.range[0]'] !== undefined) update = { 'xaxis.range': [ev['xaxis.range[0]'], ev['xaxis.range[1]']] };
    else if (Array.isArray(ev['xaxis.range'])) update = { 'xaxis.range': ev['xaxis.range'] };
    if (!update) return;
    const targets = componentsCards.map(c => c.el.plot).filter(p => p !== source && p.data && p.offsetParent !== null);
    if (!targets.length) return;
    syncingTimeAxes = true;
    Promise.all(targets.map(p => Plotly.relayout(p, update))).finally(() => { syncingTimeAxes = false; });
}

// Test for the hydro series of a Bus (hydro bus) or Link (a port on a hydro bus) timeseries
function hydroSeriesTest(componentType, cls) {
    const hydroBuses = new Set(networkData.hydro_buses || []);
    if (cls === 'Bus') return name => hydroBuses.has(name);
    const staticData = networkData.components[componentType].static;
    const busAttrs = Object.keys(staticData).filter(a => /^bus\d+$/.test(a));
    return name => busAttrs.some(a => hydroBuses.has(staticData[a][name]));
}
