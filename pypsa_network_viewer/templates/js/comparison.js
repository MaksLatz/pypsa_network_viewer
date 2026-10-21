// Comparison tab: frozen copies of Power Balance and Network Components graphs. "Add to Comparison" in those
// tabs copies the graph as it is (series, filters, unit, time range): later changes there do not change the
// copy, so the same graph can be compared with different settings. Two layouts:
//  - Stacked: one graph above the other, time axes linked (zooming one zooms all);
//  - Overlay: the chosen series of all the graphs in one plot, one y-axis per unit.
// Each graph has its own unit (MW / GW, ...): graphs shown in the same unit share a y-axis in Overlay.
// The copies are kept in pages saved with "Save this view".

// Items: { id, title, subtitle, yTitle (unit when added), unit (chosen prefix, '' = as added),
//          xs: [x arrays], traces: [trace with xRef instead of x], height, hideLegend }
const comparisonItems = [];
let comparisonSeq = 0;
const COMPARISON_HEIGHTS = [['300', 'Small'], ['450', 'Medium'], ['600', 'Large']];
const comparisonState = { layout: 'stacked', overlayHeight: '600' };
// Series shown in Overlay (attr 'series'; empty = all)
const COMPARISON_OVERLAY_FILTER = '__comparisonOverlay';

// Local wall-clock time 'YYYY-MM-DD HH:MM:SS' (how Plotly shows Date objects), so a saved copy looks the same
const comparisonTime = d => d instanceof Date
    ? `${isoDay(d)} ${[d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':')}` : d;
// 7 significant digits are plenty for a picture and keep saved pages small
const comparisonValue = v => typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toPrecision(7)) : v;

// Short description of the filters of a filter key, e.g. 'Carrier: wind, gas · Node(s): 3 selected'
function comparisonFilterText(stateKey, labels) {
    return Object.entries(activeFilters[stateKey] || {}).filter(([, v]) => Array.isArray(v) && v.length)
        .map(([attr, v]) => `${labels[attr] || titleCase(attr)}: ${v.length <= 3 ? v.join(', ') : v.length + ' selected'}`)
        .join(' · ');
}

// Copy the graph in `plotEl` to the Comparison tab
function addToComparison(plotEl, title, subtitle) {
    if (!plotEl || !plotEl.data || !plotEl.data.length) return;
    const xs = [];
    const xRef = new Map();  // traces usually share one time axis array: store it once
    const traces = plotEl.data.map(t => {
        const { x, y, uid, ...rest } = t;
        const copy = JSON.parse(JSON.stringify(rest));
        if (!xRef.has(x)) { xRef.set(x, xs.length); xs.push(Array.from(x || [], comparisonTime)); }
        copy.xRef = xRef.get(x);
        copy.y = Array.from(y || [], comparisonValue);
        return copy;
    });
    const yaxis = (plotEl.layout && plotEl.layout.yaxis) || {};
    comparisonItems.push({
        id: ++comparisonSeq, title, subtitle,
        yTitle: typeof yaxis.title === 'object' ? (yaxis.title.text || '') : (yaxis.title || ''),
        unit: '', xs, traces, height: '450', hideLegend: false
    });
    updateComparisonTab();
}

function updateComparisonTab() {
    const btn = document.querySelector('.tab-btn[data-tab="comparison"]');
    if (btn) btn.textContent = comparisonItems.length ? `Comparison (${comparisonItems.length})` : 'Comparison';
}

// "Add to Comparison" button: briefly confirms the copy
function comparisonButton(attrs) {
    return `<button type="button" class="toggle-btn compare-btn" ${attrs}
        title="Copy this graph, as it is now, to the Comparison tab, to compare it with other graphs">＋ Add to Comparison</button>`;
}
function confirmComparisonAdd(btn) {
    btn.textContent = `✓ Added (${comparisonItems.length} in Comparison)`;
    btn.classList.add('active');
    setTimeout(() => { if (btn.isConnected) { btn.textContent = '＋ Add to Comparison'; btn.classList.remove('active'); } }, 1500);
}

// --- Units -----------------------------------------------------------------------------------------
// The item's unit as added (parsed from its y-axis title), the one shown and the factor between them
function comparisonUnit(item) {
    const base = parseUnit(item.yTitle);
    if (!base) return { base: null, label: item.yTitle, factor: 1, prefix: '' };
    const prefix = UNIT_CHOICES[base.kind].includes(item.unit) ? item.unit : base.prefix;
    return { base, prefix, label: item.yTitle.replace(base.match, unitLabel(base, prefix)), factor: unitFactor(base, prefix) };
}
function comparisonUnitButtons(item, unit) {
    if (!unit.base) return '';
    return `<div class="unit-select"><label class="control-label">Unit</label>
        <div class="button-group">${optionButtons(`comparisonUnit${item.id}`, UNIT_CHOICES[unit.base.kind].map(p => [p, unitLabel(unit.base, p)]), unit.prefix, false)}</div></div>`;
}
const scaleValues = (y, factor) => factor === 1 ? y : y.map(v => typeof v === 'number' ? v * factor : v);

// The common time range of the graphs, so they are aligned from the start
function comparisonFullRange(items = comparisonItems) {
    let lo = null, hi = null;
    items.forEach(item => item.xs.forEach(x => {
        if (!x.length) return;
        if (lo === null || x[0] < lo) lo = x[0];
        if (hi === null || x[x.length - 1] > hi) hi = x[x.length - 1];
    }));
    return lo === null ? null : [lo, hi];
}

// CSV of series given as { name, x, y } on possibly different time axes (union of the time steps).
// Stacked series drawn as a positive and a negative part under one name are written as their sum.
function saveComparisonCsv(fileName, series) {
    const columns = [];
    series.forEach(s => {
        let col = columns.find(c => c.name === s.name);
        if (!col) { col = { name: s.name, values: new Map() }; columns.push(col); }
        s.x.forEach((t, i) => col.values.set(t, (col.values.get(t) || 0) + (typeof s.y[i] === 'number' ? s.y[i] : 0)));
    });
    const times = [...new Set(series.flatMap(s => s.x))].sort();
    saveCsv(fileName, ['snapshot', ...columns.map(c => c.name)],
        times.map(t => [t, ...columns.map(c => (c.values.has(t) ? c.values.get(t) : ''))]));
}

// --- Tab ---------------------------------------------------------------------------------------------
function renderComparison() {
    const view = document.getElementById('comparisonView');
    view.querySelectorAll('.comparison-plot').forEach(p => { if (p.data) Plotly.purge(p); });
    if (!comparisonItems.length) {
        view.innerHTML = `<div class="info-panel">
            <h3>Comparison</h3>
            <p>No graphs yet. Use <strong>＋ Add to Comparison</strong> under a graph of the <strong>Power Balance</strong>
               or <strong>Network Components</strong> tab: a copy of the graph, as it is then, appears here. Add two or more
               to compare them one above the other (time axes linked) or overlaid in one plot.</p>
        </div>`;
        return;
    }
    const overlay = comparisonState.layout === 'overlay';
    view.innerHTML = `
        <div class="info-panel">
            <h3>Comparison</h3>
            <p>Copies of graphs, as they were when added: later changes in their tab do not change them.
               <strong>Stacked</strong>: one above the other, time axes linked (zoom or pan one graph and the others follow;
               double-click shows the whole time range again). <strong>Overlay</strong>: the chosen series of all graphs in one plot,
               with one y-axis per unit; set the graphs to the same unit (e.g. GW) to share an axis.</p>
        </div>
        <div class="comparison-toolbar">
            <div class="control-group">
                <label class="control-label">Layout</label>
                <div class="button-group">${optionButtons('comparisonLayout', [['stacked', 'Stacked'], ['overlay', 'Overlay']], comparisonState.layout, false)}</div>
            </div>
            <span class="stat-note">${comparisonItems.length} graph${comparisonItems.length > 1 ? 's' : ''}</span>
            <button type="button" class="link-btn" id="comparisonClear" title="Remove every graph from the Comparison tab">✕ Remove all</button>
        </div>
        <div id="comparisonBody"></div>`;
    view.querySelectorAll('[data-option=comparisonLayout]').forEach(btn => btn.addEventListener('click', function() {
        comparisonState.layout = this.dataset.value;
        renderComparison();
    }));
    document.getElementById('comparisonClear').addEventListener('click', () => {
        comparisonItems.length = 0;
        delete activeFilters[COMPARISON_OVERLAY_FILTER];
        updateComparisonTab();
        renderComparison();
    });
    if (overlay) renderComparisonOverlay(document.getElementById('comparisonBody'));
    else renderComparisonStacked(document.getElementById('comparisonBody'));
}

// Stacked: one card per graph
function renderComparisonStacked(body) {
    body.innerHTML = comparisonItems.map((item, i) => {
        const unit = comparisonUnit(item);
        return `
        <div class="graph-card comparison-card" data-item="${item.id}">
            <div class="graph-card-bar">
                <div class="comparison-head">
                    <h3>${escapeHtml(item.title)}</h3>
                    ${item.subtitle ? `<p>${escapeHtml(item.subtitle)}</p>` : ''}
                </div>
                <div class="graph-card-actions">
                    ${i > 0 ? `<button type="button" class="link-btn" data-move="-1" title="Move this graph up">▲ Up</button>` : ''}
                    ${i < comparisonItems.length - 1 ? `<button type="button" class="link-btn" data-move="1" title="Move this graph down">▼ Down</button>` : ''}
                    <button type="button" class="link-btn" data-remove title="Remove this graph from the comparison">✕ Remove</button>
                </div>
            </div>
            <div class="unit-bar">
                <div class="button-group">
                    <button type="button" class="toggle-btn" data-csv title="Download the series of this graph (in the unit shown) as CSV">⬇ Download CSV</button>
                    <button type="button" class="toggle-btn" data-legend>${item.hideLegend ? 'Show legend' : 'Hide legend'}</button>
                </div>
                ${comparisonUnitButtons(item, unit)}
                <div class="unit-select">
                    <label class="control-label">Height</label>
                    <div class="button-group">${optionButtons(`comparisonHeight${item.id}`, COMPARISON_HEIGHTS, item.height, false)}</div>
                </div>
            </div>
            <div class="plot-container"><div class="comparison-plot" style="height:${Number(item.height) || 450}px"></div></div>
        </div>`;
    }).join('');

    const range = comparisonFullRange();
    const plots = [];
    body.querySelectorAll('.comparison-card').forEach(cardEl => {
        const item = comparisonItems.find(it => it.id === Number(cardEl.dataset.item));
        const index = comparisonItems.indexOf(item);
        const unit = comparisonUnit(item);
        cardEl.querySelectorAll('[data-move]').forEach(btn => btn.addEventListener('click', () => {
            const j = index + Number(btn.dataset.move);
            [comparisonItems[index], comparisonItems[j]] = [comparisonItems[j], comparisonItems[index]];
            renderComparison();
        }));
        cardEl.querySelector('[data-remove]').addEventListener('click', () => {
            comparisonItems.splice(index, 1);
            updateComparisonTab();
            renderComparison();
        });
        cardEl.querySelector('[data-legend]').addEventListener('click', () => { item.hideLegend = !item.hideLegend; renderComparison(); });
        cardEl.querySelectorAll(`[data-option="comparisonHeight${item.id}"]`).forEach(btn => btn.addEventListener('click', function() {
            item.height = this.dataset.value;
            renderComparison();
        }));
        cardEl.querySelectorAll(`[data-option="comparisonUnit${item.id}"]`).forEach(btn => btn.addEventListener('click', function() {
            item.unit = this.dataset.value;
            renderComparison();
        }));
        cardEl.querySelector('[data-csv]').addEventListener('click', () => saveComparisonCsv(`comparison_${slug(item.title)}_${slug(unit.label)}.csv`,
            item.traces.map(t => ({ name: `${t.name || 'series'}${unit.label ? ` [${unit.label}]` : ''}`, x: item.xs[t.xRef], y: scaleValues(t.y, unit.factor) }))));

        const plot = cardEl.querySelector('.comparison-plot');
        const traces = item.traces.map(({ xRef, ...t }) => ({ ...t, x: item.xs[xRef], y: scaleValues(t.y, unit.factor) }));
        Plotly.newPlot(plot, traces, {
            xaxis: { title: 'Time', type: 'date', ...(range ? { range: [...range], autorange: false } : {}) },
            yaxis: { title: unit.label, automargin: false },
            hovermode: 'x unified',
            hoverlabel: { namelength: -1 },
            showlegend: !item.hideLegend,
            legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.25 },
            // Same left / right margins for every graph, so their time axes line up exactly
            margin: { l: 80, r: 30, t: 20, b: item.hideLegend ? 50 : 110 }
        }, { responsive: true, displayModeBar: true, displaylogo: false });
        plot.on('plotly_relayout', ev => syncComparisonAxes(plot, ev, plots));
        plots.push(plot);
    });
}

// Overlay: the chosen series of every graph in one plot; one y-axis per unit shown (left, right, then
// further out on alternate sides)
function renderComparisonOverlay(body) {
    // Options: one per legend entry of each graph, '#id Graph title › series'
    const seriesLabel = (item, t) => `#${item.id} ${item.title} › ${t.name || 'series'}`;
    const options = [...new Set(comparisonItems.flatMap(item => item.traces.map(t => seriesLabel(item, t))))];
    const picked = ((activeFilters[COMPARISON_OVERLAY_FILTER] || {}).series || []).filter(s => options.includes(s));
    const isShown = label => !picked.length || picked.includes(label);

    // Units in the order of the graphs: each its own y-axis
    const units = [];
    comparisonItems.forEach(item => {
        if (!item.traces.some(t => isShown(seriesLabel(item, t)))) return;
        const label = comparisonUnit(item).label || 'Value';
        if (!units.includes(label)) units.push(label);
    });
    const axisName = i => (i === 0 ? 'y' : `y${i + 1}`);
    // Axes 0, 2, 4, ... on the left, 1, 3, ... on the right; beyond the first on a side, they take room from the plot
    const leftExtra = Math.max(0, Math.ceil(units.length / 2) - 1), rightExtra = Math.max(0, Math.floor(units.length / 2) - 1);
    const STEP = 0.07;  // width of the extra axes, as a fraction of the plot
    const domain = [leftExtra * STEP, 1 - rightExtra * STEP];

    const unitRows = comparisonItems.map(item => {
        const unit = comparisonUnit(item);
        return `<div class="comparison-unit-row"><span class="comparison-unit-name" title="${escapeHtml(item.subtitle || '')}">#${item.id} ${escapeHtml(item.title)}</span>
            ${unit.base ? `<div class="button-group">${optionButtons(`comparisonUnit${item.id}`, UNIT_CHOICES[unit.base.kind].map(p => [p, unitLabel(unit.base, p)]), unit.prefix, false)}</div>`
                        : `<span class="stat-note">${escapeHtml(unit.label || 'no unit')}</span>`}</div>`;
    }).join('');
    body.innerHTML = `
        ${renderFilterBar(COMPARISON_OVERLAY_FILTER, [{ attr: 'series', label: 'Series shown', values: options }], options.length,
            picked.length || options.length, { id: 'comparisonOverlayFilters', title: 'Overlay', noun: 'series',
            note: 'Pick the series to overlay (all by default). Graphs in the same unit share a y-axis.' })}
        <div class="filter-bar comparison-units">
            <div class="filter-title">Units (per graph)</div>
            ${unitRows}
        </div>
        <div class="unit-bar">
            <div class="button-group">
                <button type="button" class="toggle-btn" id="comparisonOverlayCsv" title="Download the overlaid series (in the units shown) as CSV">⬇ Download CSV</button>
            </div>
            <div class="unit-select">
                <label class="control-label">Height</label>
                <div class="button-group">${optionButtons('comparisonOverlayHeight', COMPARISON_HEIGHTS, comparisonState.overlayHeight, false)}</div>
            </div>
        </div>
        <div class="plot-container"><div class="comparison-plot" id="comparisonOverlayPlot" style="height:${Number(comparisonState.overlayHeight) || 600}px"></div></div>`;
    bindFilterBar(document.getElementById('comparisonOverlayFilters'), COMPARISON_OVERLAY_FILTER, renderComparison);
    comparisonItems.forEach(item => body.querySelectorAll(`[data-option="comparisonUnit${item.id}"]`).forEach(btn =>
        btn.addEventListener('click', function() { item.unit = this.dataset.value; renderComparison(); })));
    body.querySelectorAll('[data-option=comparisonOverlayHeight]').forEach(btn => btn.addEventListener('click', function() {
        comparisonState.overlayHeight = this.dataset.value;
        renderComparison();
    }));

    const traces = [];
    const csvSeries = [];
    comparisonItems.forEach(item => {
        const unit = comparisonUnit(item);
        const axis = axisName(units.indexOf(unit.label || 'Value'));
        item.traces.forEach(({ xRef, ...t }) => {
            const label = seriesLabel(item, t);
            if (!isShown(label)) return;
            const y = scaleValues(t.y, unit.factor);
            const copy = { ...t, x: item.xs[xRef], y, yaxis: axis, name: `${t.name || 'series'} (#${item.id})`,
                           legendgroup: `${item.id}|${t.legendgroup || t.name}` };
            // Stacks stay within their own graph
            if (t.stackgroup) copy.stackgroup = `${item.id}|${t.stackgroup}`;
            traces.push(copy);
            csvSeries.push({ name: `${label} [${unit.label || 'Value'}]`, x: item.xs[xRef], y });
        });
    });
    document.getElementById('comparisonOverlayCsv').disabled = !traces.length;
    document.getElementById('comparisonOverlayCsv').addEventListener('click', () => saveComparisonCsv('comparison_overlay.csv', csvSeries));

    const layout = {
        xaxis: { title: 'Time', type: 'date', domain },
        hovermode: 'x unified',
        hoverlabel: { namelength: -1 },
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
        margin: { l: 80, r: 80, t: 30, b: 120 }
    };
    units.forEach((label, i) => {
        const side = i % 2 === 0 ? 'left' : 'right';
        const axis = { title: label, side, zeroline: true, zerolinecolor: '#bdc3c7' };
        if (i > 0) { axis.overlaying = 'y'; axis.showgrid = false; }
        if (i > 1) {  // further out: the k-th extra axis of its side
            const k = Math.floor(i / 2);
            axis.anchor = 'free';
            axis.position = side === 'left' ? Math.max(0, domain[0] - k * STEP) : Math.min(1, domain[1] + k * STEP);
        }
        layout[i === 0 ? 'yaxis' : `yaxis${i + 1}`] = axis;
    });
    if (!traces.length) layout.annotations = [{ text: 'No series selected', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false,
                                                font: { size: 16, color: '#7f8c8d' } }];
    Plotly.newPlot('comparisonOverlayPlot', traces, layout, { responsive: true, displayModeBar: true, displaylogo: false });
}

// Zooming / panning one graph applies its time range to the others; a double-click (autorange) returns all
// of them to the common full range, so they stay aligned
let syncingComparison = false;
function syncComparisonAxes(source, ev, plots) {
    if (syncingComparison) return;
    let update = null;
    const full = comparisonFullRange();
    if (ev['xaxis.autorange']) update = full ? { 'xaxis.range': full, 'xaxis.autorange': false } : { 'xaxis.autorange': true };
    else if (ev['xaxis.range[0]'] !== undefined) update = { 'xaxis.range': [ev['xaxis.range[0]'], ev['xaxis.range[1]']] };
    else if (Array.isArray(ev['xaxis.range'])) update = { 'xaxis.range': ev['xaxis.range'] };
    if (!update) return;
    const targets = ev['xaxis.autorange'] ? plots : plots.filter(p => p !== source);
    syncingComparison = true;
    Promise.all(targets.filter(p => p.data).map(p => Plotly.relayout(p, update))).finally(() => { syncingComparison = false; });
}

// Saved pages: the items as plain data (ids kept: the Overlay series selection refers to them);
// restoring checks their shape
function comparisonForSave() {
    return comparisonItems.map(item => ({ ...item }));
}
function restoreComparison(list) {
    if (!Array.isArray(list)) return;
    list.forEach(item => {
        if (!item || typeof item !== 'object' || !Array.isArray(item.xs) || !Array.isArray(item.traces)) return;
        if (!item.xs.every(Array.isArray) || !item.traces.every(t => t && Array.isArray(t.y) && Number.isInteger(t.xRef) && item.xs[t.xRef])) return;
        const id = Number.isInteger(item.id) && item.id > 0 && !comparisonItems.some(it => it.id === item.id) ? item.id : comparisonSeq + 1;
        comparisonSeq = Math.max(comparisonSeq, id);
        comparisonItems.push({
            id, title: String(item.title || 'Graph'), subtitle: String(item.subtitle || ''),
            yTitle: String(item.yTitle || ''), unit: typeof item.unit === 'string' ? item.unit : '', xs: item.xs, traces: item.traces,
            height: COMPARISON_HEIGHTS.some(h => h[0] === item.height) ? item.height : '450', hideLegend: item.hideLegend === true
        });
    });
    updateComparisonTab();
}
