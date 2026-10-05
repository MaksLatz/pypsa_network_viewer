// Page link: the current view (tab, investment period, filters and the settings of every tab) is kept in
// the URL after '#view=', so the address bar can be bookmarked or shared to reopen the same view.
// The link holds settings only, not data: it reopens the view in the same HTML file (or a copy of it).

const VIEW_LINK_PREFIX = '#view=';

function currentViewSettings() {
    const value = id => document.getElementById(id).value;
    return {
        tab: activeTab,
        period: networkData.summary.is_multi_index ? value('yearSelect') : undefined,
        filters: activeFilters,
        balance: balanceState,
        components: { type: value('componentTypeSelect'), data: value('dataTypeSelect'), ts: value('timeseriesSelect') },
        custom: { plot: value('customPlotSelect'), state: customState }
    };
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

function viewSettingsFromLink() {
    if (!location.hash.startsWith(VIEW_LINK_PREFIX)) return null;
    try {
        return JSON.parse(decodeURIComponent(location.hash.slice(VIEW_LINK_PREFIX.length)));
    } catch (e) {
        console.warn('Ignoring an unreadable view link', e);
        return null;
    }
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

// "Copy link" button in the tab bar
function setupCopyViewLink() {
    const btn = document.getElementById('copyViewLink');
    if (!btn) return;
    btn.addEventListener('click', () => {
        clearTimeout(viewLinkTimer);
        try { history.replaceState(null, '', VIEW_LINK_PREFIX + encodeURIComponent(JSON.stringify(currentViewSettings()))); } catch (e) {}
        const done = ok => {
            btn.textContent = ok ? '✓ Link copied' : 'Copy the address bar';
            setTimeout(() => { btn.textContent = '🔗 Copy link to this view'; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(location.href).then(() => done(true), () => done(false));
        } else {
            done(false);
        }
    });
}
