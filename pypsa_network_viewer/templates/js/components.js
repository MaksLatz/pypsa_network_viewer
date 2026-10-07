// Network Components tab: static tables, timeseries plots and global constraints.

// --- Network Components tab ---------------------------------------------------------
function populateComponentTypes() {
    const select = document.getElementById('componentTypeSelect');
    // Global constraints get their own entry below (a formatted table), not the generic component one
    Object.keys(networkData.components).filter(comp => comp !== 'global_constraints').forEach(comp => {
        const opt = document.createElement('option');
        opt.value = comp;
        opt.textContent = comp.charAt(0).toUpperCase() + comp.slice(1).replace(/_/g, ' ');
        select.appendChild(opt);
    });
    if (networkData.summary.global_constraints) {
        const opt = document.createElement('option');
        opt.value = 'global_constraints';
        opt.textContent = 'Global Constraints';
        select.appendChild(opt);
    }
}

// Fill the timeseries dropdown for the chosen component, keeping the previous choice when it exists
function populateTimeseriesOptions(componentType) {
    const select = document.getElementById('timeseriesSelect');
    const previous = select.value;
    const names = Object.keys(networkData.components[componentType].timeseries);
    select.innerHTML = `<option value="">${names.length ? 'Select timeseries...' : '(no timeseries available)'}</option>`;
    names.forEach(ts => {
        const opt = document.createElement('option');
        opt.value = ts;
        opt.textContent = ts;
        select.appendChild(opt);
    });
    select.value = names.includes(previous) ? previous : '';
}

// The data type (and timeseries, when available) is kept when switching component
function onComponentTypeChange() {
    const componentType = document.getElementById('componentTypeSelect').value;
    const dataTypeSelect = document.getElementById('dataTypeSelect');
    const timeseriesSelect = document.getElementById('timeseriesSelect');

    if (!componentType || componentType === 'global_constraints') {
        dataTypeSelect.disabled = true;
        timeseriesSelect.disabled = true;
    } else {
        dataTypeSelect.disabled = false;
        populateTimeseriesOptions(componentType);
        timeseriesSelect.disabled = dataTypeSelect.value !== 'timeseries';
    }
    renderComponentsView();
}

function onDataTypeChange() {
    const componentType = document.getElementById('componentTypeSelect').value;
    const timeseriesSelect = document.getElementById('timeseriesSelect');
    if (document.getElementById('dataTypeSelect').value === 'timeseries') {
        populateTimeseriesOptions(componentType);
        timeseriesSelect.disabled = false;
    } else {
        timeseriesSelect.disabled = true;
    }
    renderComponentsView();
}

// Show whatever the current selection allows; no Load button needed
function renderComponentsView() {
    const componentType = document.getElementById('componentTypeSelect').value;
    const dataType = document.getElementById('dataTypeSelect').value;
    const timeseries = document.getElementById('timeseriesSelect').value;
    const contentDiv = document.getElementById('contentDisplay');
    const hint = (title, text) => {
        contentDiv.innerHTML = `<div class="info-panel"><h3>${title}</h3>${text}</div>`;
    };

    if (!componentType) {
        hint('Instructions', `<ol class="instructions">
            <li>Choose a <strong>Component Type</strong> (Buses, Generators, … or Global Constraints).</li>
            <li>Choose <strong>Static Data</strong> for the attribute table, or <strong>Time Series</strong> for plots.</li>
            <li>For Time Series, choose the attribute to plot. The view updates as soon as the selection is complete.</li>
        </ol>`);
    } else if (componentType === 'global_constraints') {
        displayGlobalConstraints();
    } else if (dataType === 'static') {
        displayStaticData(componentType);
    } else if (dataType === 'timeseries') {
        if (timeseries) {
            displayTimeseriesData(componentType, timeseries);
        } else if (Object.keys(networkData.components[componentType].timeseries).length === 0) {
            hint('No time series', `<p>${escapeHtml(componentType)} has no timeseries data. Choose Static Data instead.</p>`);
        } else {
            hint('Select a time series', '<p>Choose the attribute to plot in the <strong>Time Series</strong> dropdown.</p>');
        }
    } else {
        hint('Select a data type', '<p>Choose <strong>Static Data</strong> or <strong>Time Series</strong>.</p>');
    }
}

// Download CSV for whatever the tab shows: a function returning { fileName, header, rows }, called on click
let componentsExport = null;

// Display settings of the timeseries plots (kept when switching component or attribute, saved in the page link):
// - showHydro: { componentType: true } shows the hydro buses / hydro links (hidden by default)
// - units: chosen prefix per kind of unit, e.g. { power: 'G' } shows MW values in GW
const HYDRO_TOGGLE_CLASSES = ['Bus', 'Link'];
const componentsView = { showHydro: {}, units: {} };

function componentsCsvBar(what) {
    return `<div class="unit-bar">
        <button type="button" class="toggle-btn" id="componentsDownload" title="Download ${escapeHtml(what)} as CSV">⬇ Download CSV</button>
    </div>`;
}

function bindComponentsCsv(makeExport) {
    componentsExport = makeExport;
    document.getElementById('componentsDownload').addEventListener('click', () => {
        const { fileName, header, rows } = componentsExport();
        saveCsv(fileName, header, rows);
    });
}

function displayGlobalConstraints() {
    const data = networkData.summary.global_constraints;
    const contentDiv = document.getElementById('contentDisplay');

    if (!data || data.length === 0) {
        contentDiv.innerHTML = '<div class="error-panel"><strong>No global constraints available</strong></div>';
        return;
    }

    const columns = Object.keys(data[0]);
    let html = `<div class="info-panel"><h3>Global Constraints</h3><p>Showing ${data.length} constraint(s)</p></div>
        ${componentsCsvBar('the global constraints table')}
        <div class="data-table"><table><thead><tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
    data.forEach(row => {
        html += '<tr>' + columns.map(c => `<td>${row[c] ?? 'N/A'}</td>`).join('') + '</tr>';
    });
    html += '</tbody></table></div>';
    contentDiv.innerHTML = html;
    bindComponentsCsv(() => ({
        fileName: 'global_constraints.csv',
        header: columns,
        rows: data.map(row => columns.map(c => row[c] ?? ''))
    }));
    currentData = { type: 'global_constraints', data };
}

function displayStaticData(componentType) {
    const data = networkData.components[componentType].static;
    const contentDiv = document.getElementById('contentDisplay');

    if (!data || Object.keys(data).length === 0) {
        contentDiv.innerHTML = `<div class="error-panel"><strong>No static data available for ${componentType}</strong></div>`;
        return;
    }

    const columns = Object.keys(data);
    const indices = Object.keys(data[columns[0]] || {});

    let html = `<div class="info-panel"><h3>${componentType.charAt(0).toUpperCase() + componentType.slice(1)} - Static Data</h3>
        <p>Showing ${indices.length} components with ${columns.length} properties</p></div>
        ${componentsCsvBar('this static data table')}
        <div class="data-table"><table><thead><tr><th>Component</th>
        ${columns.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;

    indices.forEach(idx => {
        html += `<tr><td><strong>${idx}</strong></td>` +
            columns.map(c => `<td>${data[c][idx] ?? 'N/A'}</td>`).join('') + '</tr>';
    });

    html += '</tbody></table></div>';
    contentDiv.innerHTML = html;
    bindComponentsCsv(() => ({
        fileName: `${componentType}_static.csv`,
        header: ['Component', ...columns],
        rows: indices.map(idx => [idx, ...columns.map(c => data[c][idx] ?? '')])
    }));
    currentData = { type: 'static', componentType, data };
}

function displayTimeseriesData(componentType, timeseriesName) {
    const data = networkData.components[componentType].timeseries[timeseriesName];
    const contentDiv = document.getElementById('contentDisplay');

    if (!data || Object.keys(data.data).length === 0) {
        contentDiv.innerHTML = `<div class="error-panel"><strong>No timeseries data for ${componentType} - ${timeseriesName}</strong></div>`;
        return;
    }

    let { timeIndex, timeStrings, seriesData, periodLabel } = applyPeriodFilter(data.time_index, data.data);
    const rerender = () => displayTimeseriesData(componentType, timeseriesName);
    const cls = getComponentClass(componentType);

    // Hydro buses (Buses) / links touching a hydro bus (Links): hidden unless the toggle is on.
    // Applied first, so the node filters below only offer what can be shown.
    let hydroCount = 0;
    if (HYDRO_TOGGLE_CLASSES.includes(cls)) {
        const isHydro = hydroSeriesTest(componentType, cls);
        hydroCount = Object.keys(seriesData).filter(isHydro).length;
        if (!componentsView.showHydro[componentType]) {
            seriesData = Object.fromEntries(Object.entries(seriesData).filter(([n]) => !isHydro(n)));
        }
    }

    // Attribute filters (carrier / type / bus for generators, bus0 / bus1 for links, node for buses / stores)
    const filterCfg = getFilterConfig(componentType);
    const totalSeries = Object.keys(data.data).length;
    let filterValues = null;
    if (filterCfg) {
        filterValues = cascadeFilterValues(componentType, componentType, filterCfg, Object.keys(seriesData));
        seriesData = applyAttributeFilters(componentType, componentType, filterCfg, seriesData);
    }
    const shownSeries = Object.keys(seriesData).length;
    const hydroLabel = cls === 'Link' ? 'hydro links' : 'hydro buses';
    const hydroButton = hydroCount
        ? `<div class="control-group"><button type="button" class="toggle-btn${componentsView.showHydro[componentType] ? ' active' : ''}" id="componentsHydroToggle"
              title="Show or hide the ${hydroLabel} (names ending in ${escapeHtml((networkData.hydro_suffixes || []).join(', '))})">
              ${componentsView.showHydro[componentType] ? 'Shown' : 'Hidden'}: ${hydroCount} ${hydroLabel}</button></div>`
        : '';
    const filterHtml = filterCfg
        ? renderFilterBar(componentType, filterValues, totalSeries, shownSeries,
            { id: 'timeseriesFilters', note: FILTER_NOTES[cls], extraHtml: hydroButton })
        : '';

    // Unit: MW / MWh / <currency>/MWh can be converted; anything else is shown as exported
    const unit = parseUnit(data.unit);
    const prefix = unit ? componentsView.units[unit.kind] || unit.prefix : null;
    const factor = unitFactor(unit, prefix);
    const shownUnit = unit ? data.unit.replace(unit.match, unitLabel(unit, prefix)) : (data.unit || 'Value');
    const unitChoices = unit ? UNIT_CHOICES[unit.kind].map(p => [p, unitLabel(unit, p)]) : [['', 'n/a']];
    const unitBar = `<div class="unit-bar">
        <button type="button" class="toggle-btn" id="componentsDownload" title="Download the plotted series (current filters, period and unit) as CSV">⬇ Download CSV</button>
        <div class="unit-select" title="${unit ? '' : 'Only MW, MWh and price (per MWh) values can be converted'}">
            <label class="control-label">Unit</label>
            <div class="button-group">${optionButtons('componentsUnit', unitChoices, prefix || '', !unit)}</div>
        </div>
    </div>`;

    contentDiv.innerHTML = `
        <div class="info-panel">
            <h3>${componentType.charAt(0).toUpperCase() + componentType.slice(1)} - ${timeseriesName}${periodLabel}</h3>
            <p><strong>Time Range:</strong> ${data.time_range.start} to ${data.time_range.end}</p>
            <p><strong>Series:</strong> ${shownSeries} of ${totalSeries} with ${timeIndex.length} time steps shown</p>
        </div>
        ${filterHtml}
        ${shownSeries === 0 ? '' : unitBar}
        <div class="plot-container">${shownSeries === 0
            ? '<div class="error-panel"><strong>No series match the selected filters.</strong></div>'
            : '<div id="timeseriesPlot" style="width:100%;height:600px;"></div>'}</div>`;

    currentData = { type: 'timeseries', componentType, timeseriesName, data };
    if (filterCfg) bindFilterBar(document.getElementById('timeseriesFilters'), componentType, rerender);
    const hydroToggle = document.getElementById('componentsHydroToggle');
    if (hydroToggle) hydroToggle.addEventListener('click', () => {
        componentsView.showHydro[componentType] = !componentsView.showHydro[componentType];
        rerender();
    });
    if (shownSeries === 0) return;
    contentDiv.querySelectorAll('[data-option=componentsUnit]').forEach(btn => btn.addEventListener('click', function() {
        componentsView.units[unit.kind] = this.dataset.value;
        rerender();
    }));

    const names = Object.keys(seriesData);
    const scaled = Object.fromEntries(names.map(n => [n, factor === 1 ? seriesData[n]
        : seriesData[n].map(v => typeof v === 'number' ? v * factor : v)]));
    const period = slug(periodLabel);
    bindComponentsCsv(() => ({
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

    Plotly.newPlot('timeseriesPlot', traces, {
        title: `${componentType} - ${timeseriesName}${periodLabel}`,
        xaxis: { title: 'Time', type: 'date' },
        yaxis: { title: shownUnit },
        hovermode: 'x unified',
        hoverlabel: { namelength: -1 },  // full series names (Plotly cuts them at 15 characters by default)
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
        margin: { l: 80, r: 80, t: 80, b: 120 }
    }, { responsive: true, displayModeBar: true, displaylogo: false });
}

// Test for the hydro series of a Bus (hydro bus) or Link (a port on a hydro bus) timeseries
function hydroSeriesTest(componentType, cls) {
    const hydroBuses = new Set(networkData.hydro_buses || []);
    if (cls === 'Bus') return name => hydroBuses.has(name);
    const staticData = networkData.components[componentType].static;
    const busAttrs = Object.keys(staticData).filter(a => /^bus\d+$/.test(a));
    return name => busAttrs.some(a => hydroBuses.has(staticData[a][name]));
}
