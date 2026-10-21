// Statistics tab: the n.statistics methods (computed in Python, see extract/statistics.py), one card each
// with a bar chart, a table, a unit and a CSV download. "Statistics shown" chooses the cards (default: the
// market set); "Group by" and the Carrier / Node(s) / hydro bus filters apply to every card.
// Statistics exported per bus (by_bus) are aggregated here for the selection: sums, or for averages
// (market value, capacity factor) sum(numerator) / sum(denominator).

const STATISTICS_GROUPINGS = ['carrier', 'component', 'bus'];
// units: { statistic key: unit choice id }; hydro: rows at hydro buses included
const statisticsState = { groupBy: 'carrier', units: {}, hydro: true };
// The cards shown are a filter (attr 'method') of this key, so they are saved with the other filters
const STATISTICS_FILTER = '__statistics';
// Carrier / Node(s) filters of all the cards
const STATISTICS_ROW_FILTER = '__statisticsRows';

function formatNumber(v) {
    const abs = Math.abs(v);
    if (abs < 1e-9) v = 0;  // no '-0'
    return v.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 2 : 4 });
}

function statisticsItems() {
    const stats = networkData.statistics || {};
    return Array.isArray(stats) ? stats : (stats.items || []);  // (list: files exported before the selector)
}

// Unit choices of a statistic: [[id, label, factor from the exported unit]]; the first exported one is the default
function statisticUnitChoices(stat) {
    const unit = stat.unit || '';
    const kind = stat.unit_kind || (/Wh$/.test(unit) && !unit.includes('/') ? 'energy' : /\/MWh$/.test(unit) ? 'price'
        : unit === 'MW' ? 'capacity' : null);
    if (kind === 'energy') return [['k', 'kWh', 1e3], ['M', 'MWh', 1], ['G', 'GWh', 1e-3], ['T', 'TWh', 1e-6]];
    if (kind === 'capacity') return [['k', 'kW', 1e3], ['M', 'MW', 1], ['G', 'GW', 1e-3], ['T', 'TW', 1e-6]];
    if (kind === 'money') return [['1', unit, 1], ['k', 'k' + unit, 1e-3], ['M', 'M' + unit, 1e-6], ['bn', 'bn' + unit, 1e-9]];
    if (kind === 'price') {
        const currency = unit.replace(/\/MWh$/, '');
        return [['k', `${currency}/kWh`, 1e-3], ['M', `${currency}/MWh`, 1]];
    }
    return [];
}
function statisticUnit(stat) {
    const choices = statisticUnitChoices(stat);
    const exported = choices.find(c => c[2] === 1);
    const chosen = choices.find(c => c[0] === statisticsState.units[stat.key]) || exported;
    return chosen ? { id: chosen[0], label: chosen[1], factor: chosen[2], choices } : { id: '', label: stat.unit, factor: 1, choices };
}

// --- Rows of a statistic, with node information --------------------------------------------------------
const statisticsBusNames = () => {
    const buses = (networkData.components.buses || {}).static || {};
    return new Set(Object.keys(Object.values(buses)[0] || {}));
};

// The node a bus counts for: a hydro bus ('Frankfurt Reservoir') counts for its node ('Frankfurt') when
// that node exists; any other bus for itself
function statisticsNodeOf(nodeSet) {
    const suffixes = networkData.hydro_suffixes || [];
    const hydro = new Set(networkData.hydro_buses || []);
    return bus => {
        if (!hydro.has(bus)) return bus;
        const lower = bus.toLowerCase();
        const suffix = suffixes.find(s => lower.endsWith(s.toLowerCase()));
        const parent = suffix ? bus.slice(0, bus.length - suffix.length).trim() : null;
        return parent && nodeSet.has(parent) ? parent : bus;
    };
}

// { levels, rows, perBus, average }: the rows per bus when available (by_bus, or statistics that are per bus
// already, e.g. prices: their 'name' is the bus), else the exported grouping (no node information)
function statisticBaseRows(stat, groupBy, busNames) {
    const norm = g => Array.isArray(g)
        ? { levels: g.length ? Object.keys(g[0]).filter(k => k !== 'value') : [], rows: g } : (g || { levels: [], rows: [] });
    if (stat.by_bus && stat.by_bus.rows.length) {
        const { levels, rows, average } = stat.by_bus;
        const n = levels.length;
        return { levels, perBus: true, average, rows: rows.map(r => {
            const o = Object.fromEntries(levels.map((l, i) => [l, r[i]]));
            o.value = r[n];
            if (average) { o.num = r[n + 1]; o.den = r[n + 2]; }
            return o;
        }) };
    }
    const byComponent = norm(stat.by_component), byCarrier = norm(stat.by_carrier);
    const g = groupBy === 'component' && byComponent.rows.length ? byComponent : (byCarrier.rows.length ? byCarrier : byComponent);
    // Per bus already: one level whose values are bus names
    if (g.levels.length === 1 && g.rows.length && g.rows.every(r => busNames.has(r[g.levels[0]]))) {
        const level = g.levels[0];
        return { levels: ['bus'], perBus: true, average: false, alreadyPerBus: true,
                 rows: g.rows.map(r => ({ bus: r[level], value: r.value })) };
    }
    return { levels: g.levels, rows: g.rows, perBus: false, average: false };
}

// Sum rows over the levels not kept (averages: sum(numerator) / sum(denominator))
function aggregateStatisticRows(rows, keep, average) {
    const groups = new Map();
    rows.forEach(r => {
        const key = keep.map(l => r[l]).join('\u0001');
        let g = groups.get(key);
        if (!g) { g = { ...Object.fromEntries(keep.map(l => [l, r[l]])), value: 0, num: 0, den: 0 }; groups.set(key, g); }
        if (average) { g.num += r.num || 0; g.den += r.den || 0; } else g.value += r.value || 0;
    });
    const out = [...groups.values()];
    if (average) out.forEach(g => { g.value = g.den ? g.num / g.den : NaN; });
    return out.filter(g => Number.isFinite(g.value)).map(({ num, den, ...g }) => g);
}

function renderStatistics() {
    const view = document.getElementById('statisticsView');
    const items = statisticsItems();
    if (!STATISTICS_GROUPINGS.includes(statisticsState.groupBy)) statisticsState.groupBy = 'carrier';
    const groupBy = statisticsState.groupBy;
    const titleOf = Object.fromEntries(items.map(s => [s.key, s.title]));
    const keyOf = Object.fromEntries(items.map(s => [s.title, s.key]));

    // Selection, as card titles (what the dropdown lists); never set yet = the default cards
    const defaults = ((networkData.statistics || {}).default || items.map(s => s.key)).map(k => titleOf[k]).filter(Boolean);
    if (!activeFilters[STATISTICS_FILTER]) activeFilters[STATISTICS_FILTER] = { method: defaults };
    const picked = (activeFilters[STATISTICS_FILTER].method || []).filter(t => keyOf[t]);
    const shown = picked.length ? items.filter(s => picked.includes(s.title)) : items;  // empty = all

    // Rows of the cards shown, for the filter options
    const busNames = statisticsBusNames();
    const hydroBuses = new Set(networkData.hydro_buses || []);
    const base = Object.fromEntries(shown.filter(s => !s.error).map(s => [s.key, statisticBaseRows(s, groupBy, busNames)]));
    const allRows = Object.values(base).flatMap(b => b.rows);
    const carriers = [...new Set(allRows.map(r => r.carrier).filter(c => c !== undefined))].sort();
    const buses = [...new Set(Object.values(base).filter(b => b.perBus).flatMap(b => b.rows.map(r => r.bus)))];
    const nodeOptions = buses.filter(b => !hydroBuses.has(b)).sort();
    const nodeOf = statisticsNodeOf(new Set(nodeOptions));
    const hydroRows = Object.values(base).filter(b => b.perBus).reduce((a, b) => a + b.rows.filter(r => hydroBuses.has(r.bus)).length, 0);

    const selected = activeFilters[STATISTICS_ROW_FILTER] || {};
    const pickedCarriers = (selected.carrier || []).filter(c => carriers.includes(c));
    const pickedNodes = (selected.bus || []).filter(b => nodeOptions.includes(b));

    const selector = renderFilterBar(STATISTICS_FILTER,
        [{ attr: 'method', label: 'Statistics shown', values: items.map(s => s.title) }],
        items.length, shown.length,
        { id: 'statisticsSelector', noun: 'statistics',
          extraHtml: `<div class="control-group">
              <label class="control-label">Group by</label>
              <div class="button-group">${optionButtons('statsGroupBy', [['carrier', 'Carrier'], ['component', 'Component & carrier'], ['bus', 'Node & carrier']], groupBy, false)}</div>
          </div>` });
    const hydroButton = hydroRows
        ? `<div class="control-group"><button type="button" class="toggle-btn${statisticsState.hydro ? ' active' : ''}" id="statisticsHydro"
              title="Include or exclude what happens at the hydro buses (names ending in ${escapeHtml((networkData.hydro_suffixes || []).join(', '))}), e.g. hydro stores, inflows and the turbine / pump links' hydro side. With nodes selected, a hydro bus counts for its node (Frankfurt Reservoir for Frankfurt).">
              Hydro buses: ${statisticsState.hydro ? 'Included' : 'Excluded'}</button></div>` : '';
    const filterCfg = [{ attr: 'carrier', label: 'Carrier', values: carriers }];
    if (nodeOptions.length) filterCfg.push({ attr: 'bus', label: 'Node(s)', values: nodeOptions });
    const rowFilters = renderFilterBar(STATISTICS_ROW_FILTER, filterCfg, carriers.length,
        pickedCarriers.length || carriers.length,
        { id: 'statisticsRowFilters', title: 'Filters (all statistics)', noun: 'carriers', extraHtml: hydroButton,
          note: pickedNodes.length ? `Nodes: ${pickedNodes.length} of ${nodeOptions.length} selected.` : '' });

    view.innerHTML = `
        <div class="info-panel">
            <h3>Statistics</h3>
            <p>Key results of the optimisation from PyPSA's <code>n.statistics</code>, over all snapshots.
               Pick the statistics to show below (Reset Filters returns to the default selection); filter them by carrier
               and node; hover over a bar for its exact value; choose each card's unit and download its table as CSV.</p>
        </div>
        ${selector}
        ${rowFilters}
        <div class="statistics-grid">${shown.map(s => `<div class="stat-card" id="statCard-${s.key}"></div>`).join('')}</div>`;

    // The dropdown lists titles in method order (not alphabetically), defaults first
    bindFilterBar(document.getElementById('statisticsSelector'), STATISTICS_FILTER, renderStatistics, () => {
        activeFilters[STATISTICS_FILTER] = { method: defaults };
    });
    bindFilterBar(document.getElementById('statisticsRowFilters'), STATISTICS_ROW_FILTER, renderStatistics, () => {
        statisticsState.hydro = true;
    });
    const hydroBtn = document.getElementById('statisticsHydro');
    if (hydroBtn) hydroBtn.addEventListener('click', () => { statisticsState.hydro = !statisticsState.hydro; renderStatistics(); });
    view.querySelectorAll('[data-option=statsGroupBy]').forEach(btn => btn.addEventListener('click', function() {
        statisticsState.groupBy = this.dataset.value;
        renderStatistics();
    }));

    const filter = { carriers: pickedCarriers, nodes: pickedNodes, hydro: statisticsState.hydro, hydroBuses, nodeOf };
    shown.forEach(stat => renderStatisticCard(stat, groupBy, base[stat.key], filter));
}

// Rows of a card after the filters and the grouping; plus notes on what could not be applied
function filteredStatisticRows(stat, groupBy, base, f) {
    const notes = [];
    let rows = base.rows;
    if (f.carriers.length) rows = rows.filter(r => r.carrier === undefined || f.carriers.includes(r.carrier));
    const nodeFiltered = f.nodes.length || (!f.hydro && f.hydroBuses.size);
    if (base.perBus) {
        if (!f.hydro) rows = rows.filter(r => !f.hydroBuses.has(r.bus));
        if (f.nodes.length) rows = rows.filter(r => f.nodes.includes(f.nodeOf(r.bus)));
    } else if (nodeFiltered) {
        notes.push(`The Node / hydro bus filters do not apply here: whole network shown${stat.by_bus_note ? ` (${stat.by_bus_note})` : ''}.`);
    }
    let levels = base.levels;
    if (base.perBus && !base.alreadyPerBus) {
        // Keep the grouping's levels; per node, a hydro bus is shown with its node when nodes are selected
        const drop = groupBy === 'carrier' ? ['component', 'bus'] : groupBy === 'component' ? ['bus'] : ['component'];
        levels = base.levels.filter(l => !drop.includes(l));
        rows = aggregateStatisticRows(rows, levels, base.average);
        const differs = (stat.by_bus.differs || []).filter(c => rows.some(r => r.carrier === c));
        if (differs.length && !levels.includes('component')) {
            notes.push(`Across components, ${differs.join(', ')} differ from n.statistics.${stat.key}(aggregate_across_components=True): ` +
                       'here only the components with a value count (PyPSA also divides by components without one, e.g. Stores).');
        }
    } else if (groupBy === 'bus' && !base.perBus) {
        notes.push('Not available per node: grouped by carrier.');
    }
    if (f.carriers.length && !base.levels.includes('carrier')) notes.push('This statistic has no carrier: the Carrier filter does not apply.');
    return { levels, rows, notes };
}

function renderStatisticCard(stat, groupBy, base, filter) {
    const card = document.getElementById(`statCard-${stat.key}`);
    const unit = statisticUnit(stat);
    const unitBar = unit.choices.length > 1
        ? `<div class="unit-select"><label class="control-label">Unit</label>
              <div class="button-group">${optionButtons(`statUnit-${stat.key}`, unit.choices.map(c => [c[0], c[1]]), unit.id, false)}</div></div>`
        : '';
    const head = `<div class="stat-card-head"><h3>${escapeHtml(stat.title)}</h3><span class="stat-unit">${escapeHtml(unit.label)}</span></div>
        <p class="stat-description">${escapeHtml(stat.description)}</p>`;
    if (stat.error) {
        card.innerHTML = head + `<div class="error-panel">${escapeHtml(stat.error)}</div>`;
        return;
    }

    // Columns: the grouping's index levels (e.g. component, carrier, bus_carrier; or bus for prices)
    const { levels, rows: raw, notes } = filteredStatisticRows(stat, groupBy, base, filter);
    const labelOf = r => {
        const main = r.carrier !== undefined ? r.carrier : r[levels[levels.length - 1]];
        const extra = levels.filter(l => l !== 'carrier' && r[l] !== main).map(l => r[l]);
        return extra.length ? `${main} (${extra.join(', ')})` : String(main);
    };
    const rows = raw.map(r => ({ ...r, value: r.value * unit.factor, label: labelOf(r) })).sort((a, b) => b.value - a.value);
    const colorOf = r => r.carrier !== undefined ? carrierColor(r.carrier) : '#2980b9';
    const additive = stat.additive !== undefined ? stat.additive : ['supply', 'system_cost'].includes(stat.key);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const grouping = levels.includes('component') ? 'Per component & carrier'
        : levels.includes('bus') && levels.includes('carrier') ? 'Per node & carrier'
        : levels.includes('carrier') ? 'Per carrier' : `Per ${levels.join(' & ') || 'item'}`;
    const unitText = unit.label ? ` ${unit.label}` : '';

    card.innerHTML = head + `
        ${notes.map(n => `<div class="filter-note">${escapeHtml(n)}</div>`).join('')}
        ${rows.length ? '<div class="stat-chart-wrap"><div class="stat-chart"></div></div>'
                      : '<div class="error-panel">No values for the selected filters.</div>'}
        <div class="unit-bar">
            <span class="stat-note">${escapeHtml(grouping)} · ${rows.length} rows${additive ? ` · total ${escapeHtml(formatNumber(total))}${escapeHtml(unitText)}` : ''}</span>
            <div class="button-group">
                <button type="button" class="toggle-btn stat-download" title="Download this table as CSV" ${rows.length ? '' : 'disabled'}>⬇ Download CSV</button>
            </div>
            ${unitBar}
        </div>
        <div class="data-table stat-table"><table>
            <thead><tr>${levels.map(c => `<th>${c === 'bus' ? 'Node' : titleCase(c)}</th>`).join('')}<th class="num">Value${unit.label ? ` [${escapeHtml(unit.label)}]` : ''}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>${levels.map(c => `<td>${c === 'carrier'
                ? `<span class="swatch-inline" style="background:${escapeHtml(colorOf(r))}"></span>` : ''}${escapeHtml(r[c])}</td>`).join('')}
                <td class="num">${escapeHtml(formatNumber(r.value))}</td></tr>`).join('')}
            ${additive && rows.length ? `<tr class="total-row"><td colspan="${levels.length}">Total</td><td class="num">${escapeHtml(formatNumber(total))}</td></tr>` : ''}
            </tbody></table></div>`;

    card.querySelectorAll(`[data-option="statUnit-${stat.key}"]`).forEach(btn => btn.addEventListener('click', function() {
        statisticsState.units[stat.key] = this.dataset.value;
        renderStatisticCard(stat, groupBy, base, filter);
    }));
    card.querySelector('.stat-download').addEventListener('click', () => saveCsv(
        `statistics_${stat.key}_${levels.join('_')}.csv`,
        [...levels, `${stat.title}${unit.label ? ` [${unit.label}]` : ''}`],
        rows.map(r => [...levels.map(c => r[c]), r.value])));
    if (!rows.length) return;

    // Horizontal bars, largest on top; tall lists scroll inside the card
    const chart = card.querySelector('.stat-chart');
    chart.style.height = Math.max(240, rows.length * 24 + 90) + 'px';
    Plotly.react(chart, [{
        type: 'bar', orientation: 'h',
        x: rows.map(r => r.value), y: rows.map(r => r.label),
        marker: { color: rows.map(colorOf) },
        hovertemplate: `%{y}: %{x:,.4~r}${unitText}<extra></extra>`
    }], {
        margin: { l: 10, r: 20, t: 10, b: 50 },
        xaxis: { title: unit.label, tickformat: '~s', zeroline: true, zerolinecolor: '#7f8c8d', automargin: true },
        yaxis: { autorange: 'reversed', automargin: true },
        bargap: 0.25
    }, { responsive: true, displayModeBar: false });
}
