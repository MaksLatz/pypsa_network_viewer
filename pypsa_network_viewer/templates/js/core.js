// Shared data, constants and helpers used by every tab.
// All JS modules are concatenated into one <script> (see render.py), so they share one global scope.
// `networkData` (everything exported by Python, see extract/) is defined by page.html just before.

let currentData = null;

const HYDRO_COLOR = '#00acc1';
// Pseudo-carriers of hydro links in the Power Balance (Carrier filter and breakdown):
// links leaving a hydro bus generate, links entering a hydro bus pump
const HYDRO_CARRIER = 'Hydro Generation';
const HYDRO_PUMPING = 'Hydro Pumping';
const BUS_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                    '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
const CARRIER_COLORED_CLASSES = ['Generator', 'StorageUnit', 'Store'];

// Colour of a carrier: its static 'color' attribute, else a stable fallback from the palette
function carrierColor(carrier) {
    const colors = networkData.carrier_colors || {};
    if (carrier === HYDRO_CARRIER) return colors.hydro || HYDRO_COLOR;
    // Pumping: a much darker shade of the hydro colour (same family, clearly distinct), drawn hatched
    if (carrier === HYDRO_PUMPING) return shadeColor(colors.hydro || HYDRO_COLOR, -0.55);
    if (colors[carrier]) return colors[carrier];
    return hashColor(carrier);
}

// Stable palette colour derived from a name
function hashColor(name) {
    let hash = 0;
    for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return BUS_COLORS[hash % BUS_COLORS.length];
}

// '#rrggbb' of any CSS colour ('red', 'rgb(...)', '#abc', ...), via the browser's own colour parser
let colorProbe = null;
function toHexColor(color) {
    if (!colorProbe) colorProbe = document.createElement('canvas').getContext('2d');
    colorProbe.fillStyle = '#000000';
    colorProbe.fillStyle = String(color);
    return colorProbe.fillStyle;  // '#rrggbb' for opaque colours, 'rgba(...)' otherwise
}

// Lighten (amount > 0) or darken (amount < 0) a colour; colours that are not opaque are returned as is
function shadeColor(color, amount) {
    if (!amount) return color;
    let hex = String(color).trim().replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) hex = toHexColor(color).replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
    const target = amount < 0 ? 0 : 255;
    return '#' + [0, 2, 4].map(i => {
        const c = parseInt(hex.slice(i, i + 2), 16);
        return Math.round(c + (target - c) * Math.abs(amount)).toString(16).padStart(2, '0');
    }).join('');
}

// --- Units (Power Balance, Network Components and Custom Plots) --------------------------------------
// A unit is { kind: 'power' | 'energy' | 'price', prefix: 'k' | 'M' | 'G' | 'T', currency, match }.
const UNIT_PREFIXES = { k: 1e3, M: 1e6, G: 1e9, T: 1e12 };
const UNIT_CHOICES = { power: ['k', 'M', 'G'], energy: ['k', 'M', 'G', 'T'], price: ['k', 'M'] };

// Unit found in a text such as an axis title or 'MW', 'MWh', '€/MWh' (any SI prefix); null if none
function parseUnit(text) {
    text = String(text || '');
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

// Factor turning values in `unit` into values with the prefix `prefix` (prices scale the other way)
function unitFactor(unit, prefix) {
    if (!unit || !prefix || prefix === unit.prefix) return 1;
    const ratio = UNIT_PREFIXES[unit.prefix] / UNIT_PREFIXES[prefix];
    return unit.kind === 'price' ? 1 / ratio : ratio;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// Multi-index: restrict a timeseries to the selected investment period
function applyPeriodFilter(timeStrings, seriesDict) {
    let timeIndex = timeStrings.map(t => new Date(t));
    let seriesData = seriesDict;
    let periodLabel = '';

    if (networkData.summary.is_multi_index) {
        const selectedPeriod = document.getElementById('yearSelect').value;
        if (selectedPeriod) {
            const mask = networkData.summary.period_index.map(p => p === selectedPeriod);
            timeIndex = timeIndex.filter((_, i) => mask[i]);
            timeStrings = timeStrings.filter((_, i) => mask[i]);
            seriesData = {};
            Object.entries(seriesDict).forEach(([name, values]) => {
                seriesData[name] = values ? values.filter((_, i) => mask[i]) : values;
            });
            periodLabel = ` — Period: ${selectedPeriod}`;
        }
    }
    return { timeIndex, timeStrings, seriesData, periodLabel };
}

function getComponentClass(componentType) {
    const classes = networkData.component_classes || {};
    return Object.keys(classes).find(cls => classes[cls] === componentType) || null;
}

// Local calendar day of a Date as 'YYYY-MM-DD' (the format of <input type="date">)
function isoDay(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Restrict series to the days start..end ('YYYY-MM-DD', both included; '' = open-ended).
// Also returns the first / last day available, for the date inputs' bounds.
function applyTimeRange(timeIndex, timeStrings, seriesData, start, end) {
    const first = timeIndex.length ? isoDay(timeIndex[0]) : '';
    const last = timeIndex.length ? isoDay(timeIndex[timeIndex.length - 1]) : '';
    if (!start && !end) return { timeIndex, timeStrings, seriesData, first, last };
    const mask = timeIndex.map(t => {
        const day = isoDay(t);
        return (!start || day >= start) && (!end || day <= end);
    });
    const keep = arr => arr.filter((_, i) => mask[i]);
    const filtered = {};
    Object.entries(seriesData).forEach(([k, v]) => { filtered[k] = v ? keep(v) : v; });
    return { timeIndex: keep(timeIndex), timeStrings: keep(timeStrings), seriesData: filtered, first, last };
}

// Save rows (arrays of cells) under a header row as a CSV file
function saveCsv(fileName, header, rows) {
    const csvCell = v => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header, ...rows].map(r => r.map(csvCell).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
}

// Filename-safe version of a label
function slug(text) {
    return String(text).replace(/[^0-9A-Za-z]+/g, '_').replace(/^_|_$/g, '');
}

// Show an error in the view of the tab it came from
const TAB_VIEWS = { summary: 'networkDetails', balance: 'balanceView', components: 'contentDisplay',
                    custom: 'customPlotView', explore: 'exploreView' };
function showError(message, tab) {
    const view = document.getElementById(TAB_VIEWS[tab || activeTab] || 'contentDisplay');
    if (view) view.innerHTML = `<div class="error-panel"><strong>Error:</strong> ${escapeHtml(message)}</div>`;
}
