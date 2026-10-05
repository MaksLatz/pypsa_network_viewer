// Multi-select filter bars (checkbox dropdowns) shared by every tab.

// Static attributes offered as timeseries filters, keyed by PyPSA component class
const FILTER_CONFIG = {
    Generator: [
        { attr: 'carrier', label: 'Carrier' },
        { attr: 'type', label: 'Type' },
        { attr: 'bus', label: 'Bus (node)' }
    ],
    Load: [
        { attr: 'bus', label: 'Bus (node)' }
    ],
    Link: [
        { attr: 'bus0', label: 'From bus (bus0)' },
        { attr: 'bus1', label: 'To bus (bus1)' }
    ]
};
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
    const staticData = networkData.components[componentType].static;
    const available = cfg.filter(f => staticData[f.attr]);
    return available.length > 0 ? available : null;
}

// Attribute table of a component ({ attr: { name: value } }). `source` is a component key, or already
// a table, e.g. the Power Balance's mix of generators and hydro links.
function attributeTable(source) {
    return typeof source === 'string' ? networkData.components[source].static : source;
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

// Attach the selectable values to each filter, cascading in filterCfg order: a filter only offers
// values found among the components (from names) that match the filters before it, e.g. Type only
// lists the types of the selected carrier(s). Selections that are no longer offered are dropped.
// Call before applyAttributeFilters so the dropped selections are not applied.
// extraValues ({ attr: [values] }) adds options that are not component attributes (e.g. Hydro Generation).
function cascadeFilterValues(stateKey, componentType, filterCfg, names, extraValues = {}) {
    const staticData = attributeTable(componentType);
    const selected = activeFilters[stateKey] || {};
    let pool = names;
    return filterCfg.map(f => {
        const col = staticData[f.attr];
        const values = [...new Set([...pool.map(n => col[n]).filter(v => v !== undefined),
                                    ...(extraValues[f.attr] || [])])].sort();
        if (selected[f.attr]) {
            selected[f.attr] = selected[f.attr].filter(v => values.includes(v));
            if (selected[f.attr].length) {
                const keep = new Set(selected[f.attr]);
                pool = pool.filter(n => keep.has(col[n]));
            }
        }
        return { ...f, values };
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
