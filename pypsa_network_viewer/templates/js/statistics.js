// Statistics tab: the n.statistics methods (computed in Python, see extract/statistics.py), one card each
// with a bar chart, a table and a CSV download. "Statistics shown" chooses the cards (default: the market
// set); "Group by" switches every card between per carrier and per component & carrier.

const STATISTICS_GROUPINGS = ['carrier', 'component'];
const statisticsState = { groupBy: 'carrier' };
// The cards shown are a filter (attr 'method') of this key, so they are saved with the other filters
const STATISTICS_FILTER = '__statistics';

function formatNumber(v) {
    const abs = Math.abs(v);
    if (abs < 1e-9) v = 0;  // no '-0'
    return v.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 2 : 4 });
}

function statisticsItems() {
    const stats = networkData.statistics || {};
    return Array.isArray(stats) ? stats : (stats.items || []);  // (list: files exported before the selector)
}

function renderStatistics() {
    const view = document.getElementById('statisticsView');
    const items = statisticsItems();
    const groupBy = statisticsState.groupBy;
    const titleOf = Object.fromEntries(items.map(s => [s.key, s.title]));
    const keyOf = Object.fromEntries(items.map(s => [s.title, s.key]));

    // Selection, as card titles (what the dropdown lists); never set yet = the default cards
    const defaults = ((networkData.statistics || {}).default || items.map(s => s.key)).map(k => titleOf[k]).filter(Boolean);
    if (!activeFilters[STATISTICS_FILTER]) activeFilters[STATISTICS_FILTER] = { method: defaults };
    const picked = (activeFilters[STATISTICS_FILTER].method || []).filter(t => keyOf[t]);
    const shown = picked.length ? items.filter(s => picked.includes(s.title)) : items;  // empty = all

    const selector = renderFilterBar(STATISTICS_FILTER,
        [{ attr: 'method', label: 'Statistics shown', values: items.map(s => s.title) }],
        items.length, shown.length,
        { id: 'statisticsSelector', noun: 'statistics',
          extraHtml: `<div class="control-group">
              <label class="control-label">Group by</label>
              <div class="button-group">${optionButtons('statsGroupBy', [['carrier', 'Carrier'], ['component', 'Component & carrier']], groupBy, false)}</div>
          </div>` });

    view.innerHTML = `
        <div class="info-panel">
            <h3>Statistics</h3>
            <p>Key results of the optimisation from PyPSA's <code>n.statistics</code>, over all snapshots.
               Pick the statistics to show below (Reset Filters returns to the default selection); hover over a bar
               for its exact value; download any table as CSV.</p>
        </div>
        ${selector}
        <div class="statistics-grid">${shown.map(s => `<div class="stat-card" id="statCard-${s.key}"></div>`).join('')}</div>`;

    // The dropdown lists titles in method order (not alphabetically), defaults first
    bindFilterBar(document.getElementById('statisticsSelector'), STATISTICS_FILTER, renderStatistics, () => {
        activeFilters[STATISTICS_FILTER] = { method: defaults };
    });
    view.querySelectorAll('[data-option=statsGroupBy]').forEach(btn => btn.addEventListener('click', function() {
        statisticsState.groupBy = this.dataset.value;
        renderStatistics();
    }));
    shown.forEach(stat => renderStatisticCard(stat, groupBy));
}

// Rows of a statistic for the chosen grouping, as { levels, rows } (files exported before: plain lists)
function statisticRows(stat, groupBy) {
    const norm = g => Array.isArray(g)
        ? { levels: g.length ? Object.keys(g[0]).filter(k => k !== 'value') : [], rows: g } : (g || { levels: [], rows: [] });
    const byComponent = norm(stat.by_component), byCarrier = norm(stat.by_carrier);
    return groupBy === 'component' && byComponent.rows.length ? byComponent : (byCarrier.rows.length ? byCarrier : byComponent);
}

function renderStatisticCard(stat, groupBy) {
    const card = document.getElementById(`statCard-${stat.key}`);
    const head = `<div class="stat-card-head"><h3>${escapeHtml(stat.title)}</h3><span class="stat-unit">${escapeHtml(stat.unit)}</span></div>
        <p class="stat-description">${escapeHtml(stat.description)}</p>`;
    if (stat.error) {
        card.innerHTML = head + `<div class="error-panel">${escapeHtml(stat.error)}</div>`;
        return;
    }

    // Columns: the statistic's own index levels (e.g. component, carrier, bus_carrier; or bus for prices)
    const { levels, rows: raw } = statisticRows(stat, groupBy);
    const labelOf = r => {
        const main = r.carrier !== undefined ? r.carrier : r[levels[levels.length - 1]];
        const extra = levels.filter(l => l !== 'carrier' && r[l] !== main).map(l => r[l]);
        return extra.length ? `${main} (${extra.join(', ')})` : String(main);
    };
    const rows = raw.map(r => ({ ...r, label: labelOf(r) })).sort((a, b) => b.value - a.value);
    const colorOf = r => r.carrier !== undefined ? carrierColor(r.carrier) : '#2980b9';
    const additive = stat.additive !== undefined ? stat.additive : ['supply', 'system_cost'].includes(stat.key);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const grouping = levels.includes('component') ? 'Per component & carrier'
        : levels.includes('carrier') ? 'Per carrier' : `Per ${levels.join(' & ') || 'item'}`;

    card.innerHTML = head + `
        <div class="stat-chart-wrap"><div class="stat-chart"></div></div>
        <div class="unit-bar">
            <span class="stat-note">${escapeHtml(grouping)} · ${rows.length} rows${additive ? ` · total ${escapeHtml(formatNumber(total))} ${escapeHtml(stat.unit)}` : ''}</span>
            <button type="button" class="toggle-btn stat-download" title="Download this table as CSV">⬇ Download CSV</button>
        </div>
        <div class="data-table stat-table"><table>
            <thead><tr>${levels.map(c => `<th>${titleCase(c)}</th>`).join('')}<th class="num">Value${stat.unit ? ` [${escapeHtml(stat.unit)}]` : ''}</th></tr></thead>
            <tbody>${rows.map(r => `<tr>${levels.map(c => `<td>${c === 'carrier'
                ? `<span class="swatch-inline" style="background:${escapeHtml(colorOf(r))}"></span>` : ''}${escapeHtml(r[c])}</td>`).join('')}
                <td class="num">${escapeHtml(formatNumber(r.value))}</td></tr>`).join('')}
            ${additive ? `<tr class="total-row"><td colspan="${levels.length}">Total</td><td class="num">${escapeHtml(formatNumber(total))}</td></tr>` : ''}
            </tbody></table></div>`;

    card.querySelector('.stat-download').addEventListener('click', () => saveCsv(
        `statistics_${stat.key}_${levels.join('_')}.csv`,
        [...levels, `${stat.title}${stat.unit ? ` [${stat.unit}]` : ''}`],
        rows.map(r => [...levels.map(c => r[c]), r.value])));

    // Horizontal bars, largest on top; tall lists scroll inside the card
    const chart = card.querySelector('.stat-chart');
    chart.style.height = Math.max(240, rows.length * 24 + 90) + 'px';
    Plotly.react(chart, [{
        type: 'bar', orientation: 'h',
        x: rows.map(r => r.value), y: rows.map(r => r.label),
        marker: { color: rows.map(colorOf) },
        hovertemplate: `%{y}: %{x:,.4~r} ${stat.unit}<extra></extra>`
    }], {
        margin: { l: 10, r: 20, t: 10, b: 50 },
        xaxis: { title: stat.unit, tickformat: '~s', zeroline: true, zerolinecolor: '#7f8c8d', automargin: true },
        yaxis: { autorange: 'reversed', automargin: true },
        bargap: 0.25
    }, { responsive: true, displayModeBar: false });
}
