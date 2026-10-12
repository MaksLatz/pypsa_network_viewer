// Statistics tab: five n.statistics results (computed in Python, see extract/statistics.py), one card each
// with a bar chart, a table and a CSV download. "Group by" switches every card between per carrier and
// per component & carrier (prices are always per bus).

const STATISTICS_GROUPINGS = ['carrier', 'component'];
const statisticsState = { groupBy: 'carrier' };
// Statistics whose total is meaningful (a total row is shown). Not averages such as prices, nor revenue:
// producers' revenue and consumers' payments cancel out, so its total is ~0.
const ADDITIVE_STATISTICS = ['supply', 'system_cost'];

function formatNumber(v) {
    const abs = Math.abs(v);
    if (abs < 1e-9) v = 0;  // no '-0'
    return v.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 2 : 4 });
}

function renderStatistics() {
    const view = document.getElementById('statisticsView');
    const stats = networkData.statistics || [];
    const groupBy = statisticsState.groupBy;
    view.innerHTML = `
        <div class="info-panel statistics-header">
            <div>
                <h3>Statistics</h3>
                <p>Key results of the optimisation from PyPSA's <code>n.statistics</code>, over all snapshots.
                   Hover over a bar for its exact value; download any table as CSV.</p>
            </div>
            <div class="control-group">
                <label class="control-label">Group by</label>
                <div class="button-group">${optionButtons('statsGroupBy', [['carrier', 'Carrier'], ['component', 'Component & carrier']], groupBy, false)}</div>
            </div>
        </div>
        <div class="statistics-grid">${stats.map(s => `<div class="stat-card" id="statCard-${s.key}"></div>`).join('')}</div>`;
    view.querySelectorAll('[data-option=statsGroupBy]').forEach(btn => btn.addEventListener('click', function() {
        statisticsState.groupBy = this.dataset.value;
        renderStatistics();
    }));
    stats.forEach(stat => renderStatisticCard(stat, groupBy));
}

function renderStatisticCard(stat, groupBy) {
    const card = document.getElementById(`statCard-${stat.key}`);
    const head = `<div class="stat-card-head"><h3>${escapeHtml(stat.title)}</h3><span class="stat-unit">${escapeHtml(stat.unit)}</span></div>
        <p class="stat-description">${escapeHtml(stat.description)}</p>`;
    if (stat.error) {
        card.innerHTML = head + `<div class="error-panel">${escapeHtml(stat.error)}</div>`;
        return;
    }

    // Rows to show: per bus (prices), per carrier, or per component & carrier; largest first
    const perBus = stat.key === 'prices';
    const byComponent = !perBus && groupBy === 'component' && stat.by_component.length;
    const rows = (byComponent ? stat.by_component : stat.by_carrier)
        .map(r => ({ ...r, label: perBus ? r.bus : byComponent ? `${r.carrier} (${r.component})` : r.carrier }))
        .sort((a, b) => b.value - a.value);
    const colorOf = r => perBus ? '#2980b9' : carrierColor(r.carrier);
    const additive = ADDITIVE_STATISTICS.includes(stat.key);
    const total = rows.reduce((a, r) => a + r.value, 0);
    const keyCols = perBus ? ['bus'] : byComponent ? ['component', 'carrier'] : ['carrier'];

    card.innerHTML = head + `
        <div class="stat-chart-wrap"><div class="stat-chart"></div></div>
        <div class="unit-bar">
            <span class="stat-note">${perBus ? 'Per bus' : byComponent ? 'Per component & carrier' : 'Per carrier'} · ${rows.length} rows${additive ? ` · total ${escapeHtml(formatNumber(total))} ${escapeHtml(stat.unit)}` : ''}</span>
            <button type="button" class="toggle-btn stat-download" title="Download this table as CSV">⬇ Download CSV</button>
        </div>
        <div class="data-table stat-table"><table>
            <thead><tr>${keyCols.map(c => `<th>${titleCase(c)}</th>`).join('')}<th class="num">Value [${escapeHtml(stat.unit)}]</th></tr></thead>
            <tbody>${rows.map(r => `<tr>${keyCols.map((c, i) => `<td>${i === keyCols.length - 1 && !perBus
                ? `<span class="swatch-inline" style="background:${escapeHtml(colorOf(r))}"></span>` : ''}${escapeHtml(r[c])}</td>`).join('')}
                <td class="num">${escapeHtml(formatNumber(r.value))}</td></tr>`).join('')}
            ${additive ? `<tr class="total-row"><td colspan="${keyCols.length}">Total</td><td class="num">${escapeHtml(formatNumber(total))}</td></tr>` : ''}
            </tbody></table></div>`;

    card.querySelector('.stat-download').addEventListener('click', () => saveCsv(
        `statistics_${stat.key}_${keyCols.join('_')}.csv`,
        [...keyCols, `${stat.title} [${stat.unit}]`],
        rows.map(r => [...keyCols.map(c => r[c]), r.value])));

    // Horizontal bars, largest on top; tall lists scroll inside the card
    const chart = card.querySelector('.stat-chart');
    const height = Math.max(240, rows.length * 24 + 90);
    chart.style.height = height + 'px';
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
