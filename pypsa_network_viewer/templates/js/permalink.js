// Saved views. The current view (tab, investment period, filters and the settings of every tab) is:
//  - kept in the URL after '#view=': the address bar is a personal bookmark of this file on this PC;
//  - saved with "Save this view": a copy of the page that opens on this view, to share by e-mail, Teams, ...
//    (the copy carries the settings in window.PNV_INITIAL_VIEW, see saveViewAsHtml).
// A link with settings wins over a saved copy's initial view.

const VIEW_LINK_PREFIX = '#view=';

// forFile: for a saved page, which also keeps the Comparison graphs (too large for the address bar)
function currentViewSettings(forFile = false) {
    const value = id => document.getElementById(id).value;
    return {
        comparison: forFile ? comparisonForSave() : undefined,
        comparisonView: comparisonState,
        tab: activeTab,
        period: networkData.summary.is_multi_index ? value('yearSelect') : undefined,
        filters: activeFilters,
        balance: balanceState,
        components: {
            cards: componentsCards.map(c => ({ id: c.id, type: c.type, data: c.data, ts: c.ts,
                                               showHydro: c.showHydro, units: c.units, threshold: c.threshold,
                                               hideLegend: c.hideLegend }))
        },
        custom: { plot: value('customPlotSelect'), state: customState },
        statistics: statisticsState
    };
}

// The page as it was loaded, before any tab was drawn (captured at start-up by app.js)
let pristinePage = null;
function capturePristinePage() {
    pristinePage = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
}

// Every setting changes through a click or a form change: record the view shortly after each one,
// once the page's own handlers have run
let viewLinkTimer = null;
function rememberView() {
    clearTimeout(viewLinkTimer);
    viewLinkTimer = setTimeout(() => {
        try {
            history.replaceState(null, '', VIEW_LINK_PREFIX + encodeURIComponent(JSON.stringify(currentViewSettings())));
        } catch (e) { /* e.g. history not available in a sandboxed preview */ }
    }, 100);
}
['click', 'change'].forEach(type => document.addEventListener(type, rememberView, true));

// Settings of the page link, else the initial view of a saved copy, else null
function viewSettingsFromLink() {
    if (location.hash.startsWith(VIEW_LINK_PREFIX)) {
        try {
            return JSON.parse(decodeURIComponent(location.hash.slice(VIEW_LINK_PREFIX.length)));
        } catch (e) {
            console.warn('Ignoring an unreadable view link', e);
        }
    }
    return window.PNV_INITIAL_VIEW || null;
}

// Apply the settings of the page link (anything missing or invalid keeps its default).
// Returns the tab to open, or null. Runs at start-up, before the first tab is drawn.
function applyViewLink() {
    const s = viewSettingsFromLink();
    if (!s || typeof s !== 'object') return null;
    const isObject = o => o && typeof o === 'object' && !Array.isArray(o);
    const setSelect = (id, v) => {
        const sel = document.getElementById(id);
        if (typeof v === 'string' && [...sel.options].some(o => o.value === v)) sel.value = v;
        return sel;
    };
    try {
        if (s.period !== undefined) setSelect('yearSelect', s.period);

        // Filters: { stateKey: { attr: [values] } }
        if (isObject(s.filters)) {
            Object.entries(s.filters).forEach(([key, attrs]) => {
                if (!isObject(attrs)) return;
                const clean = {};
                Object.entries(attrs).forEach(([attr, values]) => {
                    if (Array.isArray(values)) clean[attr] = values.filter(v => typeof v === 'string');
                });
                activeFilters[key] = clean;
            });
        }

        // Power Balance: only known settings, with the type of their default
        if (isObject(s.balance)) {
            const defaults = balanceDefaults();
            Object.keys(defaults).forEach(key => {
                const v = s.balance[key];
                if (key === 'visible' && isObject(v)) {
                    Object.keys(defaults.visible).forEach(g => { if (typeof v[g] === 'boolean') balanceState.visible[g] = v[g]; });
                } else if (key !== 'visible' && typeof v === typeof defaults[key]) {
                    balanceState[key] = v;
                }
            });
            if (!(balanceState.unit in BALANCE_UNITS)) balanceState.unit = defaults.unit;
        }

        // Network Components: the graph cards, created without drawing (the tab may be hidden). Views saved
        // before graph cards existed ({ type, data, ts, view }) become one card, with their filters.
        if (isObject(s.components)) {
            let cards = Array.isArray(s.components.cards) ? s.components.cards : null;
            if (!cards && typeof s.components.type === 'string') {
                const old = s.components;
                cards = [{ id: 1, type: old.type, data: old.data, ts: old.ts,
                           showHydro: (old.view || {}).showHydro, units: (old.view || {}).units }];
                if (isObject(activeFilters[old.type])) activeFilters[`card1|${old.type}`] = activeFilters[old.type];
            }
            const str = v => (typeof v === 'string' ? v : '');
            (cards || []).filter(isObject).forEach(c => {
                const showHydro = {}, units = {};
                if (isObject(c.showHydro)) Object.entries(c.showHydro).forEach(([k, v]) => { if (typeof v === 'boolean') showHydro[k] = v; });
                if (isObject(c.units)) Object.entries(c.units).forEach(([kind, prefix]) => {
                    if (UNIT_CHOICES[kind] && UNIT_CHOICES[kind].includes(prefix)) units[kind] = prefix;
                });
                addComponentsCard({ id: Number.isInteger(c.id) && c.id > 0 ? c.id : undefined,
                                    type: str(c.type), data: str(c.data), ts: str(c.ts),
                                    showHydro, units, threshold: str(c.threshold), hideLegend: c.hideLegend === true });
            });
        }

        // Statistics: grouping, units per card, hydro buses
        if (isObject(s.statistics)) {
            if (STATISTICS_GROUPINGS.includes(s.statistics.groupBy)) statisticsState.groupBy = s.statistics.groupBy;
            if (typeof s.statistics.hydro === 'boolean') statisticsState.hydro = s.statistics.hydro;
            if (isObject(s.statistics.units)) Object.entries(s.statistics.units).forEach(([key, id]) => {
                if (typeof id === 'string') statisticsState.units[key] = id;
            });
        }

        // Comparison: the graphs of a saved page (the address bar never holds them: a reloaded saved page
        // keeps its graphs)
        restoreComparison(s.comparison || (window.PNV_INITIAL_VIEW || {}).comparison);
        if (isObject(s.comparisonView)) {
            if (['stacked', 'overlay'].includes(s.comparisonView.layout)) comparisonState.layout = s.comparisonView.layout;
            if (COMPARISON_HEIGHTS.some(h => h[0] === s.comparisonView.overlayHeight)) comparisonState.overlayHeight = s.comparisonView.overlayHeight;
        }

        // Custom Plots: selected plot and per-plot settings (unit, hydro)
        if (isObject(s.custom)) {
            setSelect('customPlotSelect', s.custom.plot);
            if (isObject(s.custom.state)) {
                Object.entries(s.custom.state).forEach(([plot, st]) => {
                    if (isObject(st) && networkData.custom_plots[plot]) customState[plot] = st;
                });
            }
        }
    } catch (e) {
        console.warn('Part of the view link could not be applied', e);
    }
    return typeof s.tab === 'string' ? s.tab : null;
}

// "Save this view": download a copy of the page that opens on the current view. Works when the copy is
// sent to someone else (unlike a link, which points to a file on this PC).
// The initial view is one line inserted right after <head>. Its id is assembled at run time so the
// tag never appears as such in this script's own source (which is part of the saved page).
const INITIAL_VIEW_ID = 'pnv-' + 'initial-view';
const INITIAL_VIEW_LINE = new RegExp('<head>\\n<script id="' + INITIAL_VIEW_ID + '">[^\\n]*\\n');
function saveViewAsHtml() {
    const settings = JSON.stringify(currentViewSettings(true)).replace(/</g, '\\u003c');  // cannot close the script
    // '<\/script>': a plain closing tag here would end this page's own inline <script> block
    const script = `<script id="${INITIAL_VIEW_ID}">window.PNV_INITIAL_VIEW = ${settings};<\/script>\n`;
    // A saved copy saved again: replace its initial view instead of adding a second one
    const page = pristinePage.replace(INITIAL_VIEW_LINE, '<head>\n').replace('<head>', '<head>\n' + script);
    const blob = new Blob([page], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const tabName = (document.querySelector(`.tab-btn[data-tab="${activeTab}"]`) || {}).textContent || activeTab;
    a.download = `${slug(document.title) || 'network'}_${slug(tabName)}_view.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function setupSaveView() {
    const btn = document.getElementById('saveViewButton');
    if (btn) btn.addEventListener('click', saveViewAsHtml);
}
