// Power Balance tab: load, generation, imports, exports, storage and mismatch at the selected nodes.

// Power Balance toggle groups and display state
// color links each button to its options panel and its plot line; hint is the button tooltip
const BALANCE_GROUPS = [
    { key: 'load', label: 'Load', color: '#c0392b',
       hint: 'Power consumed by the loads at the selected nodes.' },
    { key: 'generation', label: 'Generation', color: '#27ae60',
       hint: 'Power produced at the selected nodes by the generators plus hydro: Hydro Generation (links from hydro buses) and Hydro Pumping (links to hydro buses, negative), by hydro type. Opens the generation filters; the carrier breakdown is in Chart Style.' },
    { key: 'imports', label: 'Imports', color: '#2980b9',
       hint: 'Power flowing into the selected nodes through links from other nodes (always ≥ 0). Links to hydro buses count as hydro generation / pumping instead; links between two selected nodes are internal.' },
    { key: 'exports', label: 'Exports', color: '#d35400',
       hint: 'Power flowing out of the selected nodes through links to other nodes, drawn below zero (always ≤ 0). Imports + Exports = net link flow.' },
    { key: 'storage', label: 'Storage (net)', color: '#8e44ad',
       hint: 'Storage units and stores at the selected nodes: discharge +, charging −.' },
    { key: 'mismatch', label: 'Mismatch', color: '#2c3e50',
       hint: 'Balance check: Load − (Generation + Imports + Exports + Storage + losses on links between selected nodes), using every generator and hydro link at the selected nodes. Should be zero; anything else is power not captured by these plots (e.g. AC line flows).' }
];
const BALANCE_UNITS = { kW: 1000, MW: 1, GW: 0.001 };
// Generation by Carrier draws many stacked series: beyond this span the plot slows down
const CARRIER_WARN_DAYS = 31;
const CARRIER_RECOMMENDED_MONTHS = 2;
// Default view: every plot switched off. Reset Filters in the Nodes bar returns to it.
const balanceDefaults = () => ({
    visible: { load: false, generation: false, imports: false, exports: false, storage: false, mismatch: false },
    loadSplit: false,        // one load line per bus
    genSplit: false,         // one generation line per bus
    importSplit: false,      // one import line per bus
    exportSplit: false,      // one export line per bus
    showCarriers: false,     // Chart Style: generation broken down by carrier (and hydro type)
    showSources: false,      // Chart Style: imports broken down by source node
    showDestinations: false, // Chart Style: exports broken down by destination node
    carrierMode: 'stacked',  // 'lines' | 'stacked' (applies to every breakdown)
    stackStyle: 'filled',    // 'filled' | 'line'
    rangeStart: '',          // Time Range, 'YYYY-MM-DD' ('' = from the first snapshot)
    rangeEnd: '',            // inclusive; '' = to the last snapshot
    unit: 'MW'
});
const balanceState = balanceDefaults();
// Filter state keys for the Power Balance view (kept separate from the component tabs)
const BALANCE_NODE_FILTERS = '__balance_nodes';  // shared node picker for all plots
const BALANCE_GEN_FILTERS = '__balance_generators';
let balanceExport = null;  // what the Power Balance plot currently shows, for CSV download

// Hydro links take part in the Generation filters as pseudo-generators, one per direction and hydro type:
// HYDRO_KEY_PREFIX + 'generation|Reservoir', with carrier Hydro Generation / Hydro Pumping and type Reservoir
const HYDRO_KEY_PREFIX = '__hydro__|';
// Generators with one of these carriers (lower case) are counted as Hydro Generation, by their 'type'
// (e.g. run of river), together with the hydro links
const HYDRO_GENERATOR_CARRIERS = ['hydro'];
const isHydroKey = name => name.startsWith(HYDRO_KEY_PREFIX);
const hydroKeyParts = key => {
    const [direction, ...type] = key.slice(HYDRO_KEY_PREFIX.length).split('|');
    return { direction, type: type.join('|') };
};

// Plotly traces for one breakdown series (a carrier, an import source or an export destination). When
// stacked, the positive and negative parts stack separately, up from and down from zero, so mixed-sign
// series stack correctly; both parts share one legend entry.
// m.hatched marks a series drawn with a hatch pattern / dashed line (Hydro Pumping).
function breakdownTraces(m, x, y, stacked, filled) {
    const base = { x, type: 'scatter', mode: 'lines', name: m.label, legendgroup: 'breakdown|' + m.label };
    const dash = m.hatched ? 'dash' : m.source && !stacked ? 'dot' : 'solid';
    const line = () => ({ width: stacked && filled ? 0.5 : 2, color: m.color, dash });
    if (!stacked) return [{ ...base, y, line: line() }];

    let parts = [['pos', y.map(v => Math.max(v, 0))], ['neg', y.map(v => Math.min(v, 0))]]
        .filter(([, values]) => values.some(v => v !== 0));
    if (parts.length === 0) parts = [['pos', y]];
    return parts.map(([sign, values], i) => {
        const t = { ...base, y: values, line: line(), stackgroup: 'breakdown-' + sign, showlegend: i === 0 };
        if (filled) t.fillcolor = m.color; else t.fill = 'none';
        if (filled && m.hatched) t.fillpattern = { shape: '/', fgcolor: 'white', size: 8, solidity: 0.3 };
        if (sign === 'neg' && !m.hatched) t.opacity = 0.6;  // exports: same colour, lighter
        return t;
    });
}

// Colour of a hydro breakdown series: the carrier colour of the hydro type if defined, else shades of
// the hydro colour (one per type, by position in `types`); pumping uses a darker shade, drawn hatched
function hydroColor(direction, type, types) {
    const colors = networkData.carrier_colors || {};
    const i = Math.max(0, types.indexOf(type));
    const base = colors[type] || colors.hydro || HYDRO_COLOR;
    const shade = colors[type] ? 0 : [0, 0.35, -0.25, 0.6][i % 4];
    return direction === 'pumping' ? shadeColor(shadeColor(base, shade), -0.55) : shadeColor(base, shade);
}

// Hydro type of a hydro bus: the suffix it ends with, e.g. 'Reservoir'
function hydroType(bus, suffixes) {
    const name = String(bus).trim().toLowerCase();
    return suffixes.find(s => name.endsWith(s.toLowerCase())) || 'Hydro';
}

// Resolve a balance entry to { name: values } (either referenced component data or inline series)
function resolveBalanceSeries(entry) {
    if (!entry) return null;
    if (entry.ref) {
        const [comp, attr] = entry.ref;
        return networkData.components[comp].timeseries[attr].data;
    }
    return entry.series;
}

function sumSeries(names, series, length) {
    const out = new Array(length).fill(0);
    names.forEach(name => {
        const values = series[name];
        if (!values) return;
        for (let i = 0; i < length; i++) out[i] += values[i] || 0;
    });
    return out;
}

// Sum series grouped by keyFn(name); returns { groupKey: values } sorted by key
function groupSeries(names, series, keyFn, length) {
    const groups = {};
    names.forEach(name => {
        const key = keyFn(name);
        (groups[key] = groups[key] || []).push(name);
    });
    const out = {};
    Object.keys(groups).sort().forEach(key => { out[key] = sumSeries(groups[key], series, length); });
    return out;
}

// On/off button bound to a boolean in balanceState
function flagButton(key, label) {
    return `<div class="control-group"><button type="button" class="toggle-btn${balanceState[key] ? ' active' : ''}" data-flag="${key}">${label}</button></div>`;
}

// Link flows at the given (non-hydro) nodes, from the nodes' perspective: p_i is the power a link
// withdraws from bus_i, so -p_i flows into the node. Each link end at a selected node is classified:
//  - hydro link (touches a hydro bus): hydro generation if it leaves the hydro bus (hydro bus = bus0),
//    hydro pumping if it enters it; typed by the hydro bus suffix. Belongs to Generation.
//  - link to another selected node: internal; only its losses remain once both ends are summed.
//  - link to any other node: an import when power flows in (> 0), an export when it flows out (< 0),
//    decided per link and time step, so Imports and Exports are gross flows.
// Imports / exports are keyed by selected bus when split (otherwise ''), and by the other end's node.
function computeLinkFlows(balance, length, nodes, split) {
    const info = balance.links;
    const suffixes = balance.hydro_suffixes;
    const hydroBuses = new Set(balance.hydro_buses);
    const linkStatic = networkData.components[info.component].static;
    const busAttrs = Object.keys(linkStatic).filter(a => /^bus\d+$/.test(a));
    const zeros = () => new Array(length).fill(0);
    const slot = (obj, key) => obj[key] = obj[key] || zeros();

    const hydroRole = name => {
        const attr = busAttrs.find(a => hydroBuses.has(linkStatic[a][name]));
        if (!attr) return null;
        return { direction: attr === 'bus1' ? 'pumping' : 'generation', type: hydroType(linkStatic[attr][name], suffixes) };
    };
    const roles = {};
    const roleOf = name => (name in roles ? roles[name] : (roles[name] = hydroRole(name)));

    const flow = () => ({ flows: {}, total: zeros(), byNode: {}, links: new Set() });
    const imports = flow(), exports = flow();
    // Unsplit totals always exist, so Imports / Exports still show (as zero) when every link is internal
    if (!split) { slot(imports.flows, ''); slot(exports.flows, ''); }
    const internal = zeros();
    const hydro = { series: {}, byBus: {} };   // 'HYDRO_KEY' -> values / { bus: values }
    info.ports.forEach(port => {
        const series = resolveBalanceSeries(port);
        const otherAttr = port.bus_attr === 'bus0' ? 'bus1' : 'bus0';
        port.names.forEach(name => {
            const bus = linkStatic[port.bus_attr][name];
            const values = series[name];
            if (!nodes.has(bus) || !values) return;
            const role = roleOf(name);
            if (role) {
                const key = HYDRO_KEY_PREFIX + role.direction + '|' + role.type;
                const acc = slot(hydro.series, key);
                const perBus = slot(hydro.byBus[key] = hydro.byBus[key] || {}, bus);
                for (let i = 0; i < length; i++) {
                    const v = -(values[i] || 0);
                    acc[i] += v;
                    perBus[i] += v;
                }
                return;
            }
            const other = linkStatic[otherAttr][name];
            if (nodes.has(other)) {
                for (let i = 0; i < length; i++) internal[i] -= values[i] || 0;
                return;
            }
            const splitKey = split ? bus : '';
            const imp = [slot(imports.flows, splitKey), imports.total, slot(imports.byNode, other)];
            const exp = [slot(exports.flows, splitKey), exports.total, slot(exports.byNode, other)];
            for (let i = 0; i < length; i++) {
                const v = -(values[i] || 0);
                if (v > 0) imp.forEach(a => { a[i] += v; });
                else if (v < 0) exp.forEach(a => { a[i] += v; });
            }
            imports.links.add(name);
            exports.links.add(name);
        });
    });
    const allLinks = info.ports.length ? info.ports[0].names : [];
    return {
        imports, exports, internal, hydro,
        connected: imports.links.size,
        totalLinks: allLinks.filter(n => !roleOf(n)).length
    };
}

// Build the Power Balance skeleton; controls and plot are filled by refreshBalance()
function displayLoadGeneration() {
    const contentDiv = document.getElementById('balanceView');

    if (!networkData.balance) {
        contentDiv.innerHTML = '<div class="error-panel"><strong>No load or generation data available</strong></div>';
        return;
    }

    // Controls in a left sidebar, the plot on the right at full window height (it stays in view while
    // the sidebar scrolls). The instructions are rendered once so their open / closed state is kept.
    const balance = networkData.balance;
    const notes = [];
    if (balance.load_source === 'p_set') notes.push('Load shows the p_set input (network has no optimised load results).');
    if (!balance.generators) notes.push('Generation dispatch is unavailable — optimise the network to see generation.');
    contentDiv.innerHTML = `
        <div class="balance-layout">
            <aside class="balance-sidebar">
                <details class="info-panel balance-help" id="balanceInfo">
                    <summary>How to use</summary>
                    <ol class="instructions">
                        <li>Pick the node(s) to analyse in <strong>Nodes</strong> (All = the whole network). <strong>Reset Filters</strong> there returns to the starting view.</li>
                        <li>All plots start switched off: switch them on with the coloured buttons. Switching a plot on opens its options.</li>
                        <li>Hover over a button for an explanation of what it shows.</li>
                        <li>Use <strong>Chart Style</strong> to break Generation down by carrier and hydro type, Imports by source node or Exports by destination node.</li>
                        <li>Narrow the <strong>Time Range</strong>, choose the unit, and use <strong>Download CSV</strong> to save what is plotted.</li>
                        <li>The page link (address bar) remembers these settings: bookmark or share it to reopen this view.</li>
                    </ol>
                </details>
                ${notes.map(n => `<p class="balance-note"><em>${n}</em></p>`).join('')}
                <div id="balanceControls"></div>
            </aside>
            <div class="balance-main">
                <div class="plot-container"><div id="balancePlot" class="balance-plot"></div></div>
            </div>
        </div>`;
    currentData = { type: 'load_generation' };
    refreshBalance();
}

function refreshBalance() {
    const balance = networkData.balance;
    const state = balanceState;
    const scale = BALANCE_UNITS[state.unit];
    const length = balance.time_index.length;
    const hasLinks = !!(balance.links && balance.links.ports.length);
    const available = {
        load: !!balance.loads, generation: !!balance.generators,
        imports: hasLinks, exports: hasLinks, storage: !!balance.storage,
        mismatch: !!balance.loads && !!balance.generators
    };
    const isOn = key => available[key] && state.visible[key];

    // --- Shared node picker: every plot is restricted to the selected nodes (All = every non-hydro bus)
    const hydroBusSet = new Set(balance.hydro_buses);
    const nodeOptions = balance.buses.filter(b => !hydroBusSet.has(b)).sort();
    const pickedNodes = (activeFilters[BALANCE_NODE_FILTERS] || {}).bus || [];
    const nodes = new Set(pickedNodes.length ? pickedNodes : nodeOptions);
    // Split by Bus is only offered when more than one node is explicitly selected (not for All,
    // which would draw one line per bus of the whole network); otherwise it is hidden and ignored
    const multiNode = pickedNodes.length > 1;
    const loadSplit = state.loadSplit && multiNode;
    const genSplit = state.genSplit && multiNode;
    const importSplit = state.importSplit && multiNode;
    const exportSplit = state.exportSplit && multiNode;

    const attrOf = (entry, attr, fallback) => {
        const col = entry && networkData.components[entry.component].static[attr];
        return name => {
            const v = col ? col[name] : undefined;
            return v === undefined || v === '' ? fallback : v;
        };
    };
    const atNodes = entry => {
        const bus = attrOf(entry, 'bus', null);
        return entry.names.filter(n => nodes.has(bus(n)));
    };

    // --- Loads at the selected nodes
    const loadSeries = resolveBalanceSeries(balance.loads);
    const loadNames = balance.loads ? atNodes(balance.loads) : [];
    const loadBus = attrOf(balance.loads, 'bus', '(no bus)');

    // --- Link flows: imports, exports, internal losses, and hydro generation / pumping by type.
    // Imports and exports share the bus split only when both are split, so compute once per split choice.
    const links = hasLinks ? computeLinkFlows(balance, length, nodes, importSplit) : null;
    const exportFlows = hasLinks && exportSplit !== importSplit
        ? computeLinkFlows(balance, length, nodes, exportSplit).exports : links && links.exports;
    const hydroKeys = links ? Object.keys(links.hydro.series).sort() : [];

    // --- Generators at the selected nodes plus the hydro pseudo-generators, then the carrier / type
    // filters of the Generators tab (Hydro Generation / Hydro Pumping are carriers, hydro suffixes are types)
    const genSeries = resolveBalanceSeries(balance.generators);
    const genNodeNames = balance.generators ? atNodes(balance.generators) : [];
    const genCfg = balance.generators
        ? (getFilterConfig(balance.generators.component) || []).filter(f => f.attr !== 'bus') : [];
    let genNames = genNodeNames;
    let hydroSelected = hydroKeys;
    let genFilterValues = [];
    const genStatic = balance.generators ? networkData.components[balance.generators.component].static : {};
    // Hydro generators (e.g. run of river) join Hydro Generation, typed by their own 'type' attribute
    const isHydroGen = name => HYDRO_GENERATOR_CARRIERS.includes(String((genStatic.carrier || {})[name]).toLowerCase());
    const hydroGenType = name => (genStatic.type || {})[name] || '';
    if (genCfg.length) {
        const table = Object.fromEntries(genCfg.map(f => [f.attr, { ...genStatic[f.attr] }]));
        if (table.carrier) genNodeNames.filter(isHydroGen).forEach(n => { table.carrier[n] = HYDRO_CARRIER; });
        hydroKeys.forEach(key => {
            const { direction, type } = hydroKeyParts(key);
            if (table.carrier) table.carrier[key] = direction === 'pumping' ? HYDRO_PUMPING : HYDRO_CARRIER;
            if (table.type) table.type[key] = type;
        });
        const candidates = [...genNodeNames, ...hydroKeys];
        // Options only cover what is at the selected nodes, cascading Carrier -> Type
        genFilterValues = cascadeFilterValues(BALANCE_GEN_FILTERS, table, genCfg, candidates);
        const kept = Object.keys(applyAttributeFilters(BALANCE_GEN_FILTERS, table, genCfg,
            Object.fromEntries(candidates.map(n => [n, true]))));
        genNames = kept.filter(n => !isHydroKey(n));
        hydroSelected = kept.filter(isHydroKey);
    }
    const genBus = attrOf(balance.generators, 'bus', '(no bus)');
    const genCarrier = attrOf(balance.generators, 'carrier', '(no carrier)');
    const zerosFull = () => new Array(length).fill(0);
    const addTo = (acc, values) => { for (let i = 0; i < length; i++) acc[i] += values[i]; return acc; };
    // Generator output plus the given hydro series
    const genTotal = (names, keys) => {
        const out = genSeries ? sumSeries(names, genSeries, length) : zerosFull();
        keys.forEach(k => addTo(out, links.hydro.series[k]));
        return out;
    };

    // --- Storage units and stores at the selected nodes
    let storageTotal = null;
    if (balance.storage) {
        storageTotal = zerosFull();
        balance.storage.forEach(entry => addTo(storageTotal, sumSeries(atNodes(entry), resolveBalanceSeries(entry), length)));
    }

    // Aggregate on the full time axis (only for plots that are switched on), then restrict to the selected period
    const raw = {}, meta = {};
    const add = (key, values, m) => { raw[key] = values; meta[key] = m; };
    // Breakdowns (Chart Style): generation by carrier / hydro type, imports by source node, exports by
    // destination node; added first so their stacked areas are drawn underneath the total lines
    const genBreakdown = isOn('generation') && state.showCarriers;
    const importBreakdown = isOn('imports') && state.showSources;
    const exportBreakdown = isOn('exports') && state.showDestinations;
    if (genBreakdown) {
        // One series per carrier; hydro (links and hydro generators) one series per direction and type,
        // generators and links of the same type summed together
        const hydroSeries = {};
        hydroSelected.forEach(key => { hydroSeries[key] = links.hydro.series[key]; });
        if (genSeries) {
            const groupOf = name => isHydroGen(name)
                ? HYDRO_KEY_PREFIX + 'generation|' + (hydroGenType(name) || '(no type)') : genCarrier(name);
            Object.entries(groupSeries(genNames, genSeries, groupOf, length)).forEach(([key, v]) => {
                if (isHydroKey(key)) hydroSeries[key] = hydroSeries[key] ? addTo([...hydroSeries[key]], v) : v;
                else add('carrier|' + key, v, { group: 'breakdown', label: key, color: carrierColor(key) });
            });
        }
        // Hydro generation types first, then pumping types; each type gets its own shade
        const hydroTypes = [...new Set(Object.keys(hydroSeries).map(k => hydroKeyParts(k).type))].sort();
        Object.keys(hydroSeries).sort((a, b) => hydroKeyParts(a).direction.localeCompare(hydroKeyParts(b).direction) || a.localeCompare(b))
            .forEach(key => {
                const { direction, type } = hydroKeyParts(key);
                const pumping = direction === 'pumping';
                add('carrier|' + key, hydroSeries[key], {
                    group: 'breakdown', hatched: pumping,
                    label: `${pumping ? HYDRO_PUMPING : HYDRO_CARRIER} – ${type}`,
                    color: hydroColor(direction, type, hydroTypes)
                });
            });
    }
    if (importBreakdown) {
        Object.keys(links.imports.byNode).sort().forEach(src => add('source|' + src, links.imports.byNode[src],
            { group: 'breakdown', source: true, label: `Imports from ${src}`, color: hashColor(src) }));
    }
    if (exportBreakdown) {
        Object.keys(exportFlows.byNode).sort().forEach(dest => add('dest|' + dest, exportFlows.byNode[dest],
            { group: 'breakdown', source: true, label: `Exports to ${dest}`, color: hashColor(dest) }));
    }
    if (isOn('load')) {
        if (loadSplit) {
            Object.entries(groupSeries(loadNames, loadSeries, loadBus, length))
                .forEach(([bus, v]) => add('load|' + bus, v, { group: 'load', bus }));
        } else {
            add('load|', sumSeries(loadNames, loadSeries, length), { group: 'load' });
        }
    }
    if (isOn('generation')) {
        if (genSplit) {
            const byBus = genSeries ? groupSeries(genNames, genSeries, genBus, length) : {};
            hydroSelected.forEach(key => Object.entries(links.hydro.byBus[key]).forEach(([bus, v]) => {
                addTo(byBus[bus] = byBus[bus] || zerosFull(), v);
            }));
            Object.keys(byBus).sort()
                .forEach(bus => add('generation|' + bus, byBus[bus], { group: 'generation', bus }));
        } else {
            add('generation|', genTotal(genNames, hydroSelected), { group: 'generation' });
        }
    }
    if (isOn('imports')) {
        Object.keys(links.imports.flows).sort().forEach(bus =>
            add('imports|' + bus, links.imports.flows[bus], { group: 'imports', bus: bus || undefined }));
    }
    if (isOn('exports')) {
        Object.keys(exportFlows.flows).sort().forEach(bus =>
            add('exports|' + bus, exportFlows.flows[bus], { group: 'exports', bus: bus || undefined }));
    }
    if (isOn('storage')) add('storage|', storageTotal, { group: 'storage' });
    if (isOn('mismatch')) {
        // Uses every generator and hydro link at the selected nodes (carrier / type filters would distort the check)
        const load = sumSeries(loadNames, loadSeries, length);
        const gen = genTotal(genNodeNames, hydroKeys);
        const mismatch = load.map((l, i) => l - gen[i]
            - (links ? links.imports.total[i] + links.exports.total[i] + links.internal[i] : 0)
            - (storageTotal ? storageTotal[i] : 0));
        add('mismatch|', mismatch, { group: 'mismatch' });
    }
    const period = applyPeriodFilter(balance.time_index, raw);
    const { periodLabel } = period;
    const range = applyTimeRange(period.timeIndex, period.timeStrings, period.seriesData, state.rangeStart, state.rangeEnd);
    const { timeIndex, timeStrings, seriesData } = range;
    const spanDays = timeIndex.length > 1 ? (timeIndex[timeIndex.length - 1] - timeIndex[0]) / 86400000 : 0;

    // Consistent colour per bus across split load / generation / import / export lines
    const allBuses = [...new Set(Object.values(meta).map(m => m.bus).filter(b => b !== undefined))].sort();
    const busColor = bus => BUS_COLORS[allBuses.indexOf(bus) % BUS_COLORS.length];

    const stacked = state.carrierMode === 'stacked';
    const filled = state.stackStyle === 'filled';
    const exportColumns = [];
    // Object key order follows insertion, so breakdown areas are drawn first and lines stay on top
    const groupRank = Object.fromEntries(BALANCE_GROUPS.map((g, i) => [g.key, i + 1]));
    const drawn = Object.entries(seriesData).flatMap(([key, values]) => {
        const m = meta[key];
        const y = values.map(v => v * scale);
        if (m.group === 'breakdown') {
            exportColumns.push({ name: m.label, values: y });
            return breakdownTraces(m, timeIndex, y, stacked, filled);
        }
        // legendrank keeps the legend in button order (Load first) whatever the drawing order
        const t = { x: timeIndex, y, type: 'scatter', mode: 'lines', legendrank: groupRank[m.group] };
        if (m.bus !== undefined) t.legendgroup = m.bus;
        if (m.group === 'load') {
            Object.assign(t, m.bus !== undefined
                ? { name: `Load – ${m.bus}`, line: { width: 2, dash: 'dot', color: busColor(m.bus) } }
                : { name: balance.load_source === 'p' ? 'Load' : 'Load (p_set)', line: { width: 3, color: '#c0392b' } });
        } else if (m.group === 'generation') {
            Object.assign(t, m.bus !== undefined
                ? { name: `Generation – ${m.bus}`, line: { width: 2, color: busColor(m.bus) } }
                : { name: 'Generation', line: { width: 3, color: '#27ae60' } });
        } else if (m.group === 'imports') {
            Object.assign(t, m.bus !== undefined
                ? { name: `Imports – ${m.bus}`, line: { width: 2, dash: 'dashdot', color: busColor(m.bus) } }
                : { name: 'Imports', line: { width: 2.5, color: '#2980b9' } });
        } else if (m.group === 'exports') {
            Object.assign(t, m.bus !== undefined
                ? { name: `Exports – ${m.bus}`, line: { width: 2, dash: 'longdashdot', color: busColor(m.bus) } }
                : { name: 'Exports', line: { width: 2.5, color: '#d35400' } });
        } else if (m.group === 'storage') {
            Object.assign(t, { name: 'Storage (net)', line: { width: 2, dash: 'dash', color: '#8e44ad' } });
        } else if (m.group === 'mismatch') {
            Object.assign(t, { name: 'Mismatch', line: { width: 2, dash: 'dot', color: '#2c3e50' } });
        }
        exportColumns.push({ name: t.name, values: y });
        return [t];
    });
    // Plotly draws later traces on top: move the Load line(s) to the end so they stay in the foreground
    const isLoad = t => t.legendrank === groupRank.load;
    const traces = [...drawn.filter(t => !isLoad(t)), ...drawn.filter(isLoad)];
    balanceExport = { timeStrings, unit: state.unit, periodLabel, columns: exportColumns };

    // --- Controls (sidebar)
    const nodeBar = renderFilterBar(BALANCE_NODE_FILTERS,
        [{ attr: 'bus', label: 'Node(s)', values: nodeOptions }], nodeOptions.length, nodes.size,
        { id: 'balanceNodeFilters', title: 'Nodes', noun: 'nodes',
           note: 'Applies to every plot below. Hydro buses (' + balance.hydro_suffixes.join(', ') + ') are not listed: ' +
                 'their links appear under Generation as <em>Hydro Generation</em> / <em>Hydro Pumping</em>, by hydro type.' });

    // Each plot button opens its own options panel while it is switched on
    const panels = {};
    if (balance.loads) {
        panels.load = `<div class="filter-bar" id="balanceLoadOptions">
            <div class="filter-title">Load options</div>
            ${multiNode ? flagButton('loadSplit', 'Split by Bus') : ''}
            <div class="filter-count">Showing ${loadNames.length} of ${balance.loads.names.length} loads</div>
        </div>`;
    }
    if (balance.generators) {
        const genOptions = { id: 'balanceGenFilters', title: 'Generation filters', noun: 'generators and hydro types',
            extraHtml: multiNode ? flagButton('genSplit', 'Split by Bus') : '',
            note: hydroKeys.length ? '<em>Hydro Generation</em> = links from hydro buses, <em>Hydro Pumping</em> = links to hydro buses (negative); ' +
                'the Type of a hydro link is its hydro bus suffix.' : '' };
        panels.generation = genCfg.length
            ? renderFilterBar(BALANCE_GEN_FILTERS, genFilterValues,
                balance.generators.names.length + hydroKeys.length, genNames.length + hydroSelected.length, genOptions)
            : `<div class="filter-bar" id="balanceGenFilters"><div class="filter-title">Generation filters</div>${genOptions.extraHtml}</div>`;
    }
    const linkNote = 'Links between two selected nodes are internal (neither import nor export); links to hydro buses are counted under Generation.';
    if (hasLinks) {
        panels.imports = `<div class="filter-bar" id="balanceImportOptions">
            <div class="filter-title">Import options</div>
            ${multiNode ? flagButton('importSplit', 'Split by Bus') : ''}
            <div class="filter-count">${links.connected} of ${links.totalLinks} links lead to other nodes</div>
            <div class="filter-note">Power flowing <strong>into</strong> the selected node(s) from other nodes, per link and time step (≥ 0). ${linkNote}</div>
        </div>`;
        panels.exports = `<div class="filter-bar" id="balanceExportOptions">
            <div class="filter-title">Export options</div>
            ${multiNode ? flagButton('exportSplit', 'Split by Bus') : ''}
            <div class="filter-count">${links.connected} of ${links.totalLinks} links lead to other nodes</div>
            <div class="filter-note">Power flowing <strong>out of</strong> the selected node(s) to other nodes, per link and time step, drawn below zero (≤ 0).
                Imports + Exports = net link flow. ${linkNote}</div>
        </div>`;
    }

    const visibilityButtons = BALANCE_GROUPS.map(g => {
        const active = isOn(g.key);
        const caret = panels[g.key] ? `<span class="caret">${active ? '▾' : '▸'}</span>` : '';
        return `<button type="button" class="toggle-btn${active ? ' active' : ''}" data-group="${g.key}" title="${escapeHtml(g.hint)}" ${available[g.key] ? '' : 'disabled'}>
            <span class="swatch" style="background:${g.color}"></span>${g.label}${caret}</button>`;
    }).join('');

    let controls = nodeBar + `<div class="toggle-bar">${visibilityButtons}</div>`;
    BALANCE_GROUPS.forEach(g => {
        if (panels[g.key] && isOn(g.key)) {
            controls += `<div class="group-panel" style="border-left-color:${g.color}">${panels[g.key]}</div>`;
        }
    });
    // Chart Style: which breakdowns to draw and how (shared by Generation, Imports and Exports), always visible
    const breakdownButton = (flag, label, enabled, hint) =>
        `<button type="button" class="toggle-btn${state[flag] && enabled ? ' active' : ''}" data-flag="${flag}"
            title="${escapeHtml(hint)}" ${enabled ? '' : 'disabled'}>${label}</button>`;
    const anyBreakdown = genBreakdown || importBreakdown || exportBreakdown;
    controls += `<div class="filter-bar" id="balanceChartStyle">
        <div class="filter-title">Chart Style</div>
        <div class="control-group">
            <label class="control-label">Breakdown</label>
            <div class="button-group">
                ${breakdownButton('showCarriers', 'Generation by Carrier', isOn('generation'),
                    'Split Generation into one series per carrier, and hydro per type (switch Generation on to use). ' +
                    `Over more than one month the plot slows down: a Time Range of at most ${CARRIER_RECOMMENDED_MONTHS} months is recommended.`)}
                ${breakdownButton('showSources', 'Imports by Source Node', isOn('imports'),
                    'Split Imports into one series per node the power comes from (switch Imports on to use).')}
                ${breakdownButton('showDestinations', 'Exports by Destination Node', isOn('exports'),
                    'Split Exports into one series per node the power goes to (switch Exports on to use).')}
            </div>
        </div>
        <div class="control-group">
            <label class="control-label">Breakdown Style</label>
            <div class="button-group">${optionButtons('carrierMode', [['lines', 'Lines'], ['stacked', 'Stacked']], state.carrierMode, !anyBreakdown)}</div>
        </div>
        <div class="control-group">
            <label class="control-label">Stacked Style</label>
            <div class="button-group">${optionButtons('stackStyle', [['filled', 'Filled'], ['line', 'Line Only']], state.stackStyle, !anyBreakdown || !stacked)}</div>
        </div>
    </div>`;
    // Generation by Carrier over more than a month: warn; beyond the recommended maximum, offer a one-click shorter range
    if (genBreakdown && spanDays > CARRIER_WARN_DAYS) {
        const tooLong = spanDays > CARRIER_RECOMMENDED_MONTHS * 31;
        controls += `<div class="warning-panel" id="balanceCarrierWarning">
            <span>⚠ <strong>Generation by Carrier</strong> is shown over ${Math.round(spanDays)} days. Beyond one month the plot
            starts slowing down (zoom, hover and redraws lag). ${tooLong
                ? `Select a <strong>Time Range</strong> of at most ${CARRIER_RECOMMENDED_MONTHS} months to visualise the carrier breakdown.`
                : `The range is within the recommended maximum of ${CARRIER_RECOMMENDED_MONTHS} months.`}</span>
            ${tooLong ? `<button type="button" class="toggle-btn" id="balanceLimitRange">Show the first ${CARRIER_RECOMMENDED_MONTHS} months</button>` : ''}
        </div>`;
    }
    // View: time range, unit and CSV download
    controls += `<div class="filter-bar" id="balanceViewOptions">
        <div class="filter-title">View</div>
        <div class="control-group" id="balanceRange">
            <label class="control-label">Time Range</label>
            <div class="range-inputs">
                <input type="date" data-range="rangeStart" value="${state.rangeStart}" min="${range.first}" max="${range.last}" title="First day shown">
                <span>to</span>
                <input type="date" data-range="rangeEnd" value="${state.rangeEnd}" min="${range.first}" max="${range.last}" title="Last day shown (included)">
                <button type="button" class="link-btn" id="balanceFullRange" ${state.rangeStart || state.rangeEnd ? '' : 'disabled'}>Full range</button>
            </div>
        </div>
        <div class="control-group">
            <label class="control-label">Unit</label>
            <div class="button-group">${optionButtons('unit', Object.keys(BALANCE_UNITS).map(u => [u, u]), state.unit, false)}</div>
        </div>
        <div class="control-group">
            <button type="button" class="toggle-btn" id="balanceDownload" title="Download the plotted series (current nodes, filters, period, time range and unit) as CSV">⬇ Download CSV</button>
        </div>
    </div>`;

    const controlsDiv = document.getElementById('balanceControls');
    controlsDiv.innerHTML = controls;

    controlsDiv.querySelectorAll('[data-group]').forEach(btn => btn.addEventListener('click', function() {
        state.visible[this.dataset.group] = !state.visible[this.dataset.group];
        refreshBalance();
    }));
    controlsDiv.querySelectorAll('[data-flag]').forEach(btn => btn.addEventListener('click', function() {
        state[this.dataset.flag] = !state[this.dataset.flag];
        refreshBalance();
    }));
    controlsDiv.querySelectorAll('[data-option]').forEach(btn => btn.addEventListener('click', function() {
        state[this.dataset.option] = this.dataset.value;
        refreshBalance();
    }));
    document.getElementById('balanceDownload').addEventListener('click', downloadBalanceCsv);
    controlsDiv.querySelectorAll('[data-range]').forEach(input => input.addEventListener('change', function() {
        state[this.dataset.range] = this.value;
        // Keep start <= end whichever input was changed
        if (state.rangeStart && state.rangeEnd && state.rangeStart > state.rangeEnd) {
            [state.rangeStart, state.rangeEnd] = [state.rangeEnd, state.rangeStart];
        }
        refreshBalance();
    }));
    document.getElementById('balanceFullRange').addEventListener('click', () => {
        state.rangeStart = state.rangeEnd = '';
        refreshBalance();
    });
    const limitRange = document.getElementById('balanceLimitRange');
    if (limitRange) limitRange.addEventListener('click', () => {
        const start = timeIndex[0];
        const end = new Date(start.getFullYear(), start.getMonth() + CARRIER_RECOMMENDED_MONTHS, start.getDate() - 1);
        state.rangeStart = isoDay(start);
        state.rangeEnd = isoDay(end);
        refreshBalance();
    });
    // Resetting the nodes returns to the default view (every plot off, no splits, breakdowns or generator
    // filters); the unit and time range are display settings and are kept.
    // Resetting generator filters switches off the generation split.
    bindFilterBar(document.getElementById('balanceNodeFilters'), BALANCE_NODE_FILTERS, refreshBalance, () => {
        const { unit, rangeStart, rangeEnd } = state;
        Object.assign(state, balanceDefaults(), { unit, rangeStart, rangeEnd });
        delete activeFilters[BALANCE_GEN_FILTERS];
    });
    const genBar = document.getElementById('balanceGenFilters');
    if (genBar && genBar.querySelector('.reset-filters')) {
        bindFilterBar(genBar, BALANCE_GEN_FILTERS, refreshBalance, () => { state.genSplit = false; });
    }

    // --- Plot (react keeps the x-axis zoom between updates; the y-axis resets when the unit changes
    // and the x-axis when the time range changes)
    const emptyHint = traces.length ? [] : [{
        text: timeIndex.length ? 'Switch on Load, Generation, Imports or Exports above to plot them'
                                : 'No snapshots in the selected time range',
        xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { size: 16, color: '#7f8c8d' }
    }];
    Plotly.react('balancePlot', traces, {
        title: `Power Balance${periodLabel}`,
        xaxis: { title: 'Time', type: 'date', uirevision: `balance|${state.rangeStart}|${state.rangeEnd}` },
        yaxis: { title: state.unit, uirevision: state.unit, zeroline: true, zerolinecolor: '#7f8c8d' },
        annotations: emptyHint,
        hovermode: 'x unified',
        legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 },
        margin: { l: 80, r: 80, t: 80, b: 120 },
        uirevision: 'balance'
    }, { responsive: true, displayModeBar: true, displaylogo: false });
}

// Save the series currently shown in the Power Balance plot as a CSV file
function downloadBalanceCsv() {
    if (!balanceExport || balanceExport.columns.length === 0) {
        alert('Nothing to download: switch at least one plot on.');
        return;
    }
    const { timeStrings, unit, columns } = balanceExport;
    const header = ['snapshot', ...columns.map(c => `${c.name} [${unit}]`)];
    const rows = timeStrings.map((t, i) => [t, ...columns.map(c => c.values[i])]);
    const period = slug(balanceExport.periodLabel);
    saveCsv(`power_balance${period ? '_' + period : ''}_${unit}.csv`, header, rows);
}
