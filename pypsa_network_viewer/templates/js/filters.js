// Multi-select filter bars (checkbox dropdowns) shared by every tab.

// Static attributes offered as timeseries filters, keyed by PyPSA component class
const FILTER_CONFIG = {
    Generator: [
        { attr: 'carrier', label: 'Carrier' },
        { attr: 'type', label: 'Type' },
        { attr: 'bus', label: 'Bus (node)' },
        // 'name' is the component's own name (see attributeTable); last, so it only lists what remains
        { attr: 'name', label: 'Name(s)' }
    ],
    Load: [
        { attr: 'bus', label: 'Bus (node)' }
    ],
    // 'name' is the component's own name (see attributeTable): a bus is filtered by itself
    Bus: [
        { attr: 'name', label: 'Node(s)' }
    ],
    Store: [
        { attr: 'bus', label: 'Node(s)' }
    ],
    Link: [
        { attr: 'bus0', label: 'From bus (bus0)' },
        { attr: 'bus1', label: 'To bus (bus1)' },
        // Only offered when the network has hydro links (see attributeTable)
        { attr: 'hydro_role', label: 'Hydro role' },
        { attr: 'hydro_type', label: 'Hydro type' }
    ]
};
const HYDRO_ROLES = { turbine: 'Turbine (hydro → grid)', pump: 'Pump (grid → hydro)' };
const FILTER_NOTES = {
    Link: 'p0 &gt; 0 means power flows from bus0 to bus1; negative values indicate flow in the reverse direction.'
};
const activeFilters = {};  // filter state key -> { attr: [selected values] } (empty = All)
let openMultiSelect = null;  // 'stateKey|attr' of the filter dropdown currently open
const multiSelectSearch = {};  // 'stateKey|attr' -> search text
// 'stateKey|attr' -> scroll position of the option list. Every tick redraws the filter bar; the open
// dropdown is redrawn open and scrolled back here, so the list does not jump back to the top.
const multiSelectScroll = {};

// Filter definitions for a component, limited to attributes present in its static data
function getFilterConfig(componentType) {
    const cfg = FILTER_CONFIG[getComponentClass(componentType)];
    if (!cfg) return null;
    const table = attributeTable(componentType);
    const available = cfg.filter(f => table[f.attr]);
    return available.length > 0 ? available : null;
}

// Attribute table of a component ({ attr: { name: value } }). `source` is a component key, or already
// a table, e.g. the Power Balance's mix of generators and hydro links. Component tables also get a
// 'name' column (each component's own name), so e.g. buses can be filtered by name, and links with a
// port on a hydro bus get 'hydro_role' (turbine: from the hydro bus, pump: to it) and 'hydro_type' (the
// hydro bus suffix, e.g. Reservoir). The static data itself is left unchanged.
const attributeTables = {};
function attributeTable(source) {
    if (typeof source !== 'string') return source;
    if (!attributeTables[source]) {
        const staticData = networkData.components[source].static;
        const names = Object.keys(Object.values(staticData)[0] || {});
        const table = { ...staticData, name: Object.fromEntries(names.map(n => [n, n])) };
        const hydroBuses = new Set(networkData.hydro_buses || []);
        if (getComponentClass(source) === 'Generator' && staticData.carrier) {
            table.carrier = runOfRiverCarriers(staticData, hydroBuses);
        }
        if (getComponentClass(source) === 'Link' && hydroBuses.size && staticData.bus0 && staticData.bus1) {
            const suffixes = networkData.hydro_suffixes || [];
            const role = {}, type = {};
            names.forEach(n => {
                const from = staticData.bus0[n], to = staticData.bus1[n];
                role[n] = hydroBuses.has(from) ? HYDRO_ROLES.turbine : hydroBuses.has(to) ? HYDRO_ROLES.pump : '';
                type[n] = role[n] ? hydroType(hydroBuses.has(from) ? from : to, suffixes) : '';
            });
            if (Object.values(role).some(Boolean)) Object.assign(table, { hydro_role: role, hydro_type: type });
        }
        attributeTables[source] = table;
    }
    return attributeTables[source];
}

// Generator carriers as shown in the filters: a hydro carrier (html_network's hydro_generator_carriers)
// whose generators on electrical buses are all of type run of river is shown as 'Hydro Run of River'
// (inflow generators on hydro buses keep their carrier). Its colour stays the carrier's (CARRIER_ALIASES).
const RUN_OF_RIVER_LABEL = 'Hydro Run of River';
const RUN_OF_RIVER_TYPE = /^\s*(run[\s_-]*of[\s_-]*river|ror)\s*$/i;
const CARRIER_ALIASES = {};
function runOfRiverCarriers(staticData, hydroBuses) {
    const hydroCarriers = networkData.hydro_generator_carriers || ['hydro'];
    const carriers = { ...staticData.carrier };
    const onGrid = Object.keys(carriers).filter(n => !hydroBuses.has((staticData.bus || {})[n]));
    [...new Set(onGrid.map(n => carriers[n]))]
        .filter(c => hydroCarriers.includes(String(c).toLowerCase()))
        .forEach(carrier => {
            const gens = onGrid.filter(n => carriers[n] === carrier);
            if (!gens.every(n => RUN_OF_RIVER_TYPE.test((staticData.type || {})[n] || ''))) return;
            gens.forEach(n => { carriers[n] = RUN_OF_RIVER_LABEL; });
            CARRIER_ALIASES[RUN_OF_RIVER_LABEL] = carrier;
        });
    return carriers;
}

// Keep entries of seriesData whose component matches the filters stored under stateKey.
// Each filter holds a list of accepted values; an empty list means All.
function applyAttributeFilters(stateKey, componentType, filterCfg, seriesData) {
    const selected = activeFilters[stateKey] || {};
    const staticData = attributeTable(componentType);
    const result = {};
    Object.entries(seriesData).forEach(([name, values]) => {
        const keep = filterCfg.every(f => {
            const wanted = selected[f.attr];
            if (!wanted || wanted.length === 0) return true;
            return wanted.includes(staticData[f.attr][name]);
        });
        if (keep) result[name] = values;
    });
    return result;
}

// Attach the selectable values to each filter. Filters narrow each other in every direction: a filter
// only offers the values found among the components (from names) that match all the OTHER filters, e.g.
// picking node FR00 lists only the carriers / types / names at FR00, and picking a carrier lists only the
// nodes that have it. Selections that no longer match anything are dropped (call this before
// applyAttributeFilters). extraValues ({ attr: [values] }) adds options that are not component attributes.
function cascadeFilterValues(stateKey, componentType, filterCfg, names, extraValues = {}) {
    const table = attributeTable(componentType);
    const selected = activeFilters[stateKey] || {};
    const matchesOthers = (name, attr) => filterCfg.every(f => {
        if (f.attr === attr) return true;
        const wanted = selected[f.attr];
        return !wanted || !wanted.length || wanted.includes(table[f.attr][name]);
    });
    const valuesFor = f => {
        const values = new Set(names.filter(n => matchesOthers(n, f.attr)).map(n => table[f.attr][n]));
        values.delete(undefined);
        (extraValues[f.attr] || []).forEach(v => values.add(v));
        return values;
    };
    // Drop selected values that no component compatible with the other selections has; repeat until
    // stable, since dropping one selection widens the others
    for (let pass = 0; pass <= filterCfg.length; pass++) {
        let changed = false;
        filterCfg.forEach(f => {
            const wanted = selected[f.attr];
            if (!wanted || !wanted.length) return;
            const possible = valuesFor(f);
            const kept = wanted.filter(v => possible.has(v));
            if (kept.length !== wanted.length) { selected[f.attr] = kept; changed = true; }
        });
        if (!changed) break;
    }
    return filterCfg.map(f => {
        const values = valuesFor(f);
        (selected[f.attr] || []).forEach(v => values.add(v));  // a selection always stays visible
        return { ...f, values: [...values].sort() };
    });
}

// Checkbox dropdown allowing several values to be selected at once
function renderMultiSelect(stateKey, f, chosen) {
    const id = stateKey + '|' + f.attr;
    const search = multiSelectSearch[id] || '';
    const display = v => v === '' ? '(none)' : v;
    const summary = chosen.length === 0 ? 'All'
        : chosen.length <= 2 ? chosen.map(display).join(', ')
        : `${chosen.length} selected`;
    const options = f.values.map(v => {
        const hidden = search && !display(v).toLowerCase().includes(search.toLowerCase());
        // Carrier options show the carrier's colour
        const swatch = f.attr === 'carrier' && v !== ''
            ? `<span class="swatch-inline" style="background:${escapeHtml(carrierColor(v))}"></span>` : '';
        return `<label class="multi-select-option"${hidden ? ' style="display:none"' : ''}>
            <input type="checkbox" value="${escapeHtml(v)}" ${chosen.includes(v) ? 'checked' : ''}> ${swatch}${escapeHtml(display(v))}</label>`;
    }).join('');
    return `<div class="control-group">
        <label class="control-label">${escapeHtml(f.label)}</label>
        <div class="multi-select${openMultiSelect === id ? ' open' : ''}" data-filter-attr="${escapeHtml(f.attr)}">
            <button type="button" class="multi-select-toggle" title="${escapeHtml(summary)}">
                <span class="multi-select-summary">${escapeHtml(summary)}</span><span>▾</span>
            </button>
            <div class="multi-select-menu">
                ${f.values.length > 8 ? `<input type="text" class="multi-select-search" placeholder="Search..." value="${escapeHtml(search)}">` : ''}
                <div class="multi-select-actions">
                    <button type="button" class="link-btn" data-action="all-shown" title="Tick every option currently listed (e.g. all search results)">Select all shown</button>
                    <button type="button" class="link-btn" data-action="clear">Clear (show all)</button>
                </div>
                <div class="multi-select-options">${options}</div>
            </div>
        </div>
    </div>`;
}

// Filter bar markup shared by the component tabs and the Power Balance view.
// filterCfg entries carry their selectable values (see cascadeFilterValues).
// opts: id (required), title, noun (default 'series'), extraHtml, note
function renderFilterBar(stateKey, filterCfg, totalCount, shownCount, opts) {
    const selected = activeFilters[stateKey] || {};
    let html = `<div class="filter-bar" id="${opts.id}">`;
    if (opts.title) {
        html += `<div class="filter-title">${escapeHtml(opts.title)}</div>`;
    }
    filterCfg.forEach(f => { html += renderMultiSelect(stateKey, f, selected[f.attr] || []); });
    html += `<div class="control-group"><button type="button" class="reset-filters">Reset Filters</button></div>
        ${opts.extraHtml || ''}
        <div class="filter-count">Showing ${shownCount} of ${totalCount} ${opts.noun || 'series'}</div>`;
    if (opts.note) {
        html += `<div class="filter-note">${opts.note}</div>`;
    }
    return html + '</div>';
}

function closeMultiSelects() {
    openMultiSelect = null;
    document.querySelectorAll('.multi-select.open').forEach(m => m.classList.remove('open'));
}
document.addEventListener('click', e => {
    if (!e.target.closest('.multi-select')) closeMultiSelects();
});

// onReset (optional) runs when Reset Filters is pressed, before re-rendering
function bindFilterBar(root, stateKey, rerender, onReset) {
    root.querySelectorAll('.multi-select').forEach(ms => {
        const attr = ms.dataset.filterAttr;
        const id = stateKey + '|' + attr;
        ms.querySelector('.multi-select-toggle').addEventListener('click', () => {
            const willOpen = !ms.classList.contains('open');
            closeMultiSelects();
            if (willOpen) {
                ms.classList.add('open');
                openMultiSelect = id;
                const search = ms.querySelector('.multi-select-search');
                if (search) search.focus();
            }
        });
        const list = ms.querySelector('.multi-select-options');
        if (ms.classList.contains('open')) list.scrollTop = multiSelectScroll[id] || 0;
        list.addEventListener('scroll', () => { multiSelectScroll[id] = list.scrollTop; });

        const boxes = [...ms.querySelectorAll('input[type=checkbox]')];
        const setChosen = values => {
            activeFilters[stateKey] = activeFilters[stateKey] || {};
            // Every option ticked is the same as no filter: store it as All
            if (values.length === boxes.length) delete activeFilters[stateKey][attr];
            else activeFilters[stateKey][attr] = values;
            rerender();
        };
        boxes.forEach(cb => cb.addEventListener('change', () => {
            setChosen(boxes.filter(c => c.checked).map(c => c.value));
        }));
        ms.querySelector('[data-action=all-shown]').addEventListener('click', () => {
            setChosen(boxes.filter(c => c.checked || c.closest('.multi-select-option').style.display !== 'none').map(c => c.value));
        });
        ms.querySelector('[data-action=clear]').addEventListener('click', () => {
            if (activeFilters[stateKey]) delete activeFilters[stateKey][attr];
            rerender();
        });
        const search = ms.querySelector('.multi-select-search');
        if (search) search.addEventListener('input', () => {
            multiSelectSearch[id] = search.value;
            const q = search.value.toLowerCase();
            ms.querySelectorAll('.multi-select-option').forEach(o => {
                o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });
    });
    root.querySelector('.reset-filters').addEventListener('click', () => {
        delete activeFilters[stateKey];
        closeMultiSelects();
        if (onReset) onReset();
        rerender();
    });
}

function optionButtons(option, choices, current, disabled) {
    return choices.map(([value, label]) =>
        `<button type="button" class="toggle-btn${value === current && !disabled ? ' active' : ''}" data-option="${option}" data-value="${value}" ${disabled ? 'disabled' : ''}>${label}</button>`
    ).join('');
}
