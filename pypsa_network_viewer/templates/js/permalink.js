// Saved views. The current view (tab, investment period, filters and the settings of every tab) is:
//  - kept in the URL after '#view=': the address bar is a personal bookmark of this file on this PC;
//  - saved with "Save this view": a copy of the page that opens on this view, to share by e-mail, Teams, ...
//    (the copy carries the settings in window.PNV_INITIAL_VIEW, see saveViewAsHtml).
// A link with settings wins over a saved copy's initial view.

const VIEW_LINK_PREFIX = '#view=';

function currentViewSettings() {
    const value = id => document.getElementById(id).value;
    return {
        tab: activeTab,
        period: networkData.summary.is_multi_index ? value('yearSelect') : undefined,
        filters: activeFilters,
        balance: balanceState,
        components: { type: value('componentTypeSelect'), data: value('dataTypeSelect'), ts: value('timeseriesSelect'),
                      view: componentsView },
        custom: { plot: value('customPlotSelect'), state: customState }
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

        // Network Components: same steps as choosing in the dropdowns, without drawing (the tab may be hidden)
        if (isObject(s.components)) {
            const type = setSelect('componentTypeSelect', s.components.type).value;
            const dataSel = document.getElementById('dataTypeSelect');
            const tsSel = document.getElementById('timeseriesSelect');
            if (type && type !== 'global_constraints') {
                dataSel.disabled = false;
                setSelect('dataTypeSelect', s.components.data);
                populateTimeseriesOptions(type);
                setSelect('timeseriesSelect', s.components.ts);
                tsSel.disabled = dataSel.value !== 'timeseries';
            }
            const view = s.components.view;
            if (isObject(view)) {
                if (isObject(view.showHydro)) Object.entries(view.showHydro).forEach(([k, v]) => {
                    if (typeof v === 'boolean') componentsView.showHydro[k] = v;
                });
                if (isObject(view.units)) Object.entries(view.units).forEach(([kind, prefix]) => {
                    if (UNIT_CHOICES[kind] && UNIT_CHOICES[kind].includes(prefix)) componentsView.units[kind] = prefix;
                });
            }
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
    const settings = JSON.stringify(currentViewSettings()).replace(/</g, '\\u003c');  // cannot close the script
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
