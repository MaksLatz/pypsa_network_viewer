// Custom Plots tab: user-supplied Plotly figures with automatic filters, units and CSV export.

// --- Custom Plots tab -------------------------------------------------------------
function populateCustomPlots() {
    const select = document.getElementById('customPlotSelect');
    (networkData.summary.custom_plots || []).forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
}

// Custom plots are arbitrary Plotly figures that come and go, so nothing here depends on a particular plot:
// filters, units and the CSV export are derived from what each figure contains (trace names, bar
// categories, y-axis title), and anything that is not recognised is shown unchanged.
//  - Filters: when most trace names (or bar categories) are names of one component class, the plot gets
//    that class's filters (see CUSTOM_ATTR_FILTERS; Links and Buses get Nodes + Hydro Power Flow).
//    Traces that are not components (e.g. a 'Total' line) are always kept.
//  - Units: read from the y-axis title (MW, MWh or <currency>/MWh); otherwise the Unit buttons are disabled.
const CUSTOM_FILTER_CLASSES = ['Generator', 'Link', 'Bus', 'Load', 'StorageUnit', 'Store'];
const CUSTOM_ATTR_FILTERS = {
    Generator: [{ attr: 'carrier', label: 'Carrier' }, { attr: 'type', label: 'Type' }, { attr: 'bus', label: 'Node(s)' }],
    Load: [{ attr: 'bus', label: 'Node(s)' }],
    StorageUnit: [{ attr: 'carrier', label: 'Carrier' }, { attr: 'bus', label: 'Node(s)' }],
    Store: [{ attr: 'carrier', label: 'Carrier' }, { attr: 'bus', label: 'Node(s)' }]
};
const CUSTOM_NOUNS = { Generator: 'generators', Link: 'links', Bus: 'buses', Load: 'loads', StorageUnit: 'storage units', Store: 'stores' };
const UNIT_PREFIXES = { k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
const UNIT_CHOICES = { power: ['k', 'M', 'G'], energy: ['k', 'M', 'G'], price: ['k', 'M'] };
const customState = {};   // plot name -> { unit prefix, hydro: show hydro links / buses }
const customMeta = {};    // plot name -> detected filter target and unit (computed once per plot)
let customExport = null;   // what the custom plot currently shows, for CSV download
const customFilterKey = name => '__custom|' + name;

function componentNameSet(componentType) {
    const staticData = (networkData.components[componentType] || {}).static || {};
    const firstCol = Object.values(staticData)[0] || {};
    return new Set(Object.keys(firstCol));
}

// Category values of a bar trace (x for vertical bars, y for horizontal ones)
function barCategories(t) {
    const cats = t.orientation === 'h' ? t.y : t.x;
    return Array.isArray(cats) ? cats.map(String) : [];
}

// Which component class a plot shows, and whether per trace ('traces') or per bar category ('categories')
function detectCustomTarget(plot) {
    const traces = plot.data;
    const traceNames = traces.map(t => t.name).filter(n => n !== undefined && n !== null).map(String);
    const allBars = traces.length > 0 && traces.every(t => t.type === 'bar');
    const categories = allBars ? [...new Set(traces.flatMap(barCategories))] : [];
    let best = null;
    CUSTOM_FILTER_CLASSES.forEach(cls => {
        const componentType = (networkData.component_classes || {})[cls];
        if (!componentType || !networkData.components[componentType]) return;
        const names = componentNameSet(componentType);
        [['traces', traceNames], ['categories', categories]].forEach(([mode, list]) => {
            if (!list.length) return;
            const hits = list.filter(n => names.has(n)).length;
            // At least half of the names must be components; earlier classes win ties
            if (hits && hits / list.length >= 0.5 && (!best || hits > best.hits)) {
                best = { cls, componentType, mode, hits, names };
            }
        });
    });
    return best;
}

function axisTitleText(axis) {
    if (!axis || axis.title === undefined || axis.title === null) return '';
    return String(typeof axis.title === 'object' ? (axis.title.text || '') : axis.title);
}

// Unit of the y-axis from its title: '<currency>/MWh' (price), 'MWh' (energy) or 'MW' (power), any SI prefix
function detectCustomUnit(layout) {
    const text = axisTitleText(layout.yaxis);
    let m = text.match(/([^\s\/()\[\]]*)\s*\/\s*([kMGT])Wh\b/);
    if (m) return { kind: 'price', prefix: m[2], currency: m[1], match: m[0] };
    m = text.match(/\b([kMGT])Wh\b/);
    if (m) return { kind: 'energy', prefix: m[1], match: m[0] };
    m = text.match(/\b([kMGT])W\b/);
    if (m) return { kind: 'power', prefix: m[1], match: m[0] };
    return null;
}

function unitLabel(unit, prefix) {
    if (unit.kind === 'price') return `${unit.currency}/${prefix}Wh`;
    return prefix + (unit.kind === 'energy' ? 'Wh' : 'W');
}

function customPlotMeta(plotName) {
    if (!customMeta[plotName]) {
        const raw = networkData.custom_plots[plotName];
        // Tolerate figures without data / layout
        const plot = { data: Array.isArray(raw.data) ? raw.data : [], layout: raw.layout || {} };
        customMeta[plotName] = { plot, target: detectCustomTarget(plot), unit: detectCustomUnit(plot.layout) };
    }
    return customMeta[plotName];
}

// Buses of a link at every port (bus0, bus1, bus2, ...), skipping empty ports
function linkBusesOf(componentType) {
    const staticData = networkData.components[componentType].static;
    const busAttrs = Object.keys(staticData).filter(a => /^bus\d+$/.test(a));
    return name => busAttrs.map(a => staticData[a][name]).filter(b => b && b !== 'nan' && b !== 'None');
}

// Selected components of a Link / Bus plot: Nodes picker (non-hydro buses) plus the Hydro Power Flow toggle.
// Links: those connected at any port to a selected node (All = every link); hydro links (a port on a hydro
// bus) only while the toggle is on. Buses: the selected nodes, plus - while the toggle is on - the hydro
// buses linked to them (all hydro buses when no node is picked).
function nodeFilterSelection(target, key, st, plotNames) {
    const hydroBuses = new Set(networkData.hydro_buses || []);
    const selected = activeFilters[key] = activeFilters[key] || {};
    const linksType = (networkData.component_classes || {}).Link;
    const linkBuses = linksType && networkData.components[linksType] ? linkBusesOf(linksType) : () => [];
    let nodeOptions, isHydro, allowed;
    if (target.cls === 'Link') {
        isHydro = n => linkBuses(n).some(b => hydroBuses.has(b));
        nodeOptions = [...new Set(plotNames.flatMap(linkBuses).filter(b => !hydroBuses.has(b)))].sort();
    } else {
        isHydro = n => hydroBuses.has(n);
        nodeOptions = plotNames.filter(n => !isHydro(n)).sort();
    }
    selected.bus = (selected.bus || []).filter(v => nodeOptions.includes(v));
    const picked = new Set(selected.bus);
    if (target.cls === 'Link') {
        allowed = plotNames.filter(n => (st.hydro || !isHydro(n))
            && (!picked.size || linkBuses(n).some(b => picked.has(b))));
    } else {
        const linkNames = linksType && networkData.components[linksType] ? [...componentNameSet(linksType)] : [];
        const nearPicked = new Set();
        linkNames.forEach(l => {
            const buses = linkBuses(l);
            if (buses.some(b => picked.has(b))) buses.forEach(b => nearPicked.add(b));
        });
        allowed = plotNames.filter(n => isHydro(n)
            ? st.hydro && (!picked.size || nearPicked.has(n))
            : !picked.size || picked.has(n));
    }
    return {
        allowed: new Set(allowed),
        filterCfg: [{ attr: 'bus', label: 'Node(s)', values: nodeOptions }],
        hydroCount: plotNames.filter(isHydro).length
    };
}

function displayCustomPlot(plotName) {
    const view = document.getElementById('customPlotView');
    if (!networkData.custom_plots || !networkData.custom_plots[plotName]) {
        view.innerHTML = '<div class="error-panel"><strong>Custom plot data not found</strong></div>';
        return;
    }
    view.innerHTML = `
        <div class="info-panel" id="customInfo"></div>
        <div id="customControls"></div>
        <div class="plot-container"><div id="customPlot" style="width:100%;height:600px;"></div></div>`;
    refreshCustomPlot(plotName);
}

function refreshCustomPlot(plotName) {
    try {
        renderCustomPlot(plotName);
    } catch (error) {
        // A figure this viewer does not understand must not break the page: fall back to the plain figure
        console.error(error);
        const { plot } = customPlotMeta(plotName);
        document.getElementById('customControls').innerHTML =
            `<div class="error-panel"><strong>Filters and units are unavailable for this plot:</strong> ${escapeHtml(error.message)}</div>`;
        customExport = null;
        try {
            Plotly.newPlot('customPlot', plot.data, plot.layout, { responsive: true, displayModeBar: true, displaylogo: false });
        } catch (plotError) {
            showError('This plot could not be drawn: ' + plotError.message, 'custom');
        }
    }
}

function renderCustomPlot(plotName) {
    const { plot, target, unit } = customPlotMeta(plotName);
    const key = customFilterKey(plotName);
    const st = customState[plotName] = customState[plotName] || { unit: unit ? unit.prefix : null, hydro: true };
    const rerender = () => refreshCustomPlot(plotName);

    // --- Filters: the set of component names to keep (null = keep everything)
    let allowed = null, controls = '', bindings = [];
    if (target) {
        const plotNames = target.mode === 'traces'
            ? [...new Set(plot.data.map(t => String(t.name)).filter(n => target.names.has(n)))]
            : [...new Set(plot.data.flatMap(barCategories).filter(n => target.names.has(n)))];
        const noun = CUSTOM_NOUNS[target.cls];
        if (target.cls === 'Link' || target.cls === 'Bus') {
            const sel = nodeFilterSelection(target, key, st, plotNames);
            allowed = sel.allowed;
            const hydroLabel = target.cls === 'Link' ? 'hydro links' : 'hydro buses';
            controls += renderFilterBar(key, sel.filterCfg, plotNames.length, allowed.size, {
                id: 'customNodeFilters', title: 'Nodes', noun,
                note: target.cls === 'Link'
                    ? 'Shows the links connected to the selected node(s). p0 &gt; 0 means power flows from bus0 to bus1.'
                    : 'Shows the selected node(s).'
            });
            controls += `<div class="filter-bar" id="customHydroFilter">
                <div class="filter-title">Hydro Power Flow</div>
                <div class="control-group"><button type="button" class="toggle-btn${st.hydro && sel.hydroCount ? ' active' : ''}" id="customHydroToggle"
                    ${sel.hydroCount ? '' : 'disabled'} title="Show or hide the ${hydroLabel}">${st.hydro ? 'On' : 'Off'}: ${sel.hydroCount} ${hydroLabel}</button></div>
                <div class="filter-note">${sel.hydroCount
                    ? `Hydro ${target.cls === 'Link' ? 'links (a port on' : 'buses (names ending in'} ${escapeHtml((networkData.hydro_suffixes || []).join(', '))}) are toggled on their own.
                       With nodes selected, only the ${hydroLabel} connected to them are shown.`
                    : `This plot has no ${hydroLabel}.`}</div>
            </div>`;
            bindings.push(() => {
                bindFilterBar(document.getElementById('customNodeFilters'), key, rerender, () => { st.hydro = true; });
                const toggle = document.getElementById('customHydroToggle');
                toggle.addEventListener('click', () => { st.hydro = !st.hydro; rerender(); });
            });
        } else {
            const cfg = CUSTOM_ATTR_FILTERS[target.cls].filter(f => networkData.components[target.componentType].static[f.attr]);
            if (cfg.length) {
                // Cascading: Type only lists the types of the selected carrier(s), Node(s) those that remain
                const values = cascadeFilterValues(key, target.componentType, cfg, plotNames);
                const byName = Object.fromEntries(plotNames.map(n => [n, true]));
                allowed = new Set(Object.keys(applyAttributeFilters(key, target.componentType, cfg, byName)));
                controls += renderFilterBar(key, values, plotNames.length, allowed.size,
                    { id: 'customAttrFilters', title: 'Filters', noun });
                bindings.push(() => bindFilterBar(document.getElementById('customAttrFilters'), key, rerender));
            }
        }
    }
    const keepName = n => !allowed || !target.names.has(String(n)) || allowed.has(String(n));

    // --- Units: scale y values of scatter / bar traces on the main y-axis
    let factor = 1;
    if (unit && st.unit !== unit.prefix) {
        const ratio = UNIT_PREFIXES[unit.prefix] / UNIT_PREFIXES[st.unit];
        factor = unit.kind === 'price' ? 1 / ratio : ratio;
    }
    const scalable = t => ['scatter', 'scattergl', 'bar', undefined].includes(t.type)
        && t.orientation !== 'h' && (!t.yaxis || t.yaxis === 'y');
    const scale = arr => Array.isArray(arr) ? arr.map(v => typeof v === 'number' ? v * factor : v) : arr;

    const traces = [];
    plot.data.forEach(t => {
        if (target && target.mode === 'traces' && !keepName(t.name)) return;
        // Shallow copy: legend clicks set 'visible' on the plotted trace, never on the stored figure
        let out = { ...t };
        if (target && target.mode === 'categories' && allowed) {
            out = filterBarPoints(t, keepName);
        }
        if (factor !== 1 && scalable(out)) out = { ...out, y: scale(out.y) };
        traces.push(out);
    });

    // Layout copy: unit in the y-axis title; zoom kept between filter changes, y-axis reset on unit change
    const layout = JSON.parse(JSON.stringify(plot.layout));
    layout.uirevision = plotName;
    layout.xaxis = { ...(layout.xaxis || {}), uirevision: plotName };
    layout.yaxis = { ...(layout.yaxis || {}), uirevision: plotName + '|' + st.unit };
    const yTitle = axisTitleText(plot.layout.yaxis);
    if (unit) {
        const title = yTitle.replace(unit.match, unitLabel(unit, st.unit));
        layout.yaxis.title = { ...(typeof layout.yaxis.title === 'object' ? layout.yaxis.title : {}), text: title };
    }
    if (!traces.length) {
        layout.annotations = [...(layout.annotations || []), {
            text: 'No series match the selected filters', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 16, color: '#7f8c8d' }
        }];
    }
    customExport = { plotName, unitLabel: unit ? unitLabel(unit, st.unit) : '',
                      xTitle: axisTitleText(layout.xaxis), yTitle: axisTitleText(layout.yaxis) };

    // --- Info panel
    const detected = target
        ? `Filters for <strong>${escapeHtml(CUSTOM_NOUNS[target.cls])}</strong> were detected from the ${target.mode === 'traces' ? 'series names' : 'bar labels'}.`
        : 'No network components were recognised in this plot, so it has no filters.';
    document.getElementById('customInfo').innerHTML = `
        <h3>Custom Plot: ${escapeHtml(plotName)}</h3>
        <p>${detected} ${unit ? '' : 'The unit could not be read from the y-axis title, so it cannot be converted.'}</p>`;

    // --- Unit bar: Download on the left, unit selector on the right (as in Power Balance)
    const unitChoices = unit ? UNIT_CHOICES[unit.kind].map(p => [p, unitLabel(unit, p)]) : [['', 'n/a']];
    controls += `<div class="unit-bar">
        <button type="button" class="toggle-btn" id="customDownload" title="Download the plotted series (current filters, unit and legend selection) as CSV">⬇ Download CSV</button>
        <div class="unit-select" title="${unit ? '' : 'Available when the y-axis title contains a unit such as MW, MWh or $/MWh'}">
            <label class="control-label">Unit</label>
            <div class="button-group">${optionButtons('customUnit', unitChoices, st.unit || '', !unit)}</div>
        </div>
    </div>`;
    const controlsDiv = document.getElementById('customControls');
    controlsDiv.innerHTML = controls;
    bindings.forEach(bind => bind());
    controlsDiv.querySelectorAll('[data-option=customUnit]').forEach(btn => btn.addEventListener('click', function() {
        st.unit = this.dataset.value;
        rerender();
    }));
    document.getElementById('customDownload').addEventListener('click', downloadCustomCsv);

    Plotly.react('customPlot', traces, layout, { responsive: true, displayModeBar: true, displaylogo: false });
}

// Copy of a bar trace keeping only the bars whose category passes keep(); per-bar arrays follow along
function filterBarPoints(t, keep) {
    const cats = t.orientation === 'h' ? t.y : t.x;
    if (!Array.isArray(cats)) return t;
    const mask = cats.map(c => keep(c));
    const n = cats.length;
    const pick = arr => Array.isArray(arr) && arr.length === n ? arr.filter((_, i) => mask[i]) : arr;
    const out = { ...t };
    ['x', 'y', 'text', 'hovertext', 'customdata', 'ids', 'width', 'base', 'offset'].forEach(k => {
        if (k in out) out[k] = pick(out[k]);
    });
    if (out.marker) {
        out.marker = { ...out.marker, color: pick(out.marker.color), opacity: pick(out.marker.opacity) };
        if (out.marker.color === undefined) delete out.marker.color;
        if (out.marker.opacity === undefined) delete out.marker.opacity;
    }
    return out;
}

// Save what the custom plot shows (read from the plot itself, so traces hidden via the legend are skipped).
// One column per series when they share the same x values; otherwise one row per point.
function downloadCustomCsv() {
    const gd = document.getElementById('customPlot');
    const traces = (gd && gd.data ? gd.data : []).filter(t => t.visible !== false && t.visible !== 'legendonly');
    if (!customExport || traces.length === 0) {
        alert('Nothing to download: no series are shown.');
        return;
    }
    const unitSuffix = customExport.unitLabel ? ` [${customExport.unitLabel}]` : '';
    const name = (t, i) => t.name !== undefined && t.name !== null && t.name !== '' ? String(t.name) : `trace ${i + 1}`;
    const fileName = `${slug(customExport.plotName) || 'custom_plot'}${customExport.unitLabel ? '_' + slug(customExport.unitLabel) : ''}.csv`;
    const xText = v => v instanceof Date ? v.toISOString() : v;

    const pies = traces.filter(t => t.type === 'pie' && Array.isArray(t.values));
    if (pies.length === traces.length) {
        const rows = pies.flatMap((t, i) => t.values.map((v, j) => [name(t, i), (t.labels || [])[j] ?? j, v]));
        saveCsv(fileName, ['series', 'label', 'value'], rows);
        return;
    }
    // Grids (heatmap / contour): one row per cell
    const grids = traces.filter(t => Array.isArray(t.z) && t.z.every(Array.isArray));
    if (grids.length === traces.length) {
        const rows = grids.flatMap((t, i) => t.z.flatMap((row, r) => row.map((z, c) =>
            [name(t, i), xText(Array.isArray(t.x) ? t.x[c] : c), Array.isArray(t.y) ? t.y[r] : r, z])));
        saveCsv(fileName, ['series', 'x', 'y', 'z'], rows);
        return;
    }
    const xy = traces.filter(t => Array.isArray(t.x) || Array.isArray(t.y));
    if (xy.length === 0) {
        alert('This plot type cannot be exported to CSV.');
        return;
    }
    // x / y of a trace; a missing one is the point index (as Plotly draws it)
    const xs = t => Array.isArray(t.x) ? t.x : t.y.map((_, i) => i);
    const ys = t => Array.isArray(t.y) ? t.y : t.x.map((_, i) => i);
    const xKey = t => JSON.stringify(xs(t).map(xText));
    const xLabel = customExport.xTitle || 'x';
    if (xy.every(t => xKey(t) === xKey(xy[0]))) {
        const header = [xLabel, ...xy.map((t, i) => name(t, i) + unitSuffix)];
        const rows = xs(xy[0]).map((x, j) => [xText(x), ...xy.map(t => ys(t)[j])]);
        saveCsv(fileName, header, rows);
    } else {
        const rows = xy.flatMap((t, i) => xs(t).map((x, j) => [name(t, i), xText(x), ys(t)[j]]));
        saveCsv(fileName, ['series', xLabel, (customExport.yTitle || 'y')], rows);
    }
}
