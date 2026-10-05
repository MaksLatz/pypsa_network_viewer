"""
Power Balance data: per-component series of loads, generators, link ports and storage.

Aggregation (totals, per bus, per carrier, imports / exports) happens in the browser
(templates/js/balance.js) so it can follow the user's filters; this module only exports
the per-component series, referencing already-exported timeseries instead of copying them.
"""

import pandas as pd

# Buses whose name ends with one of these suffixes are hydro storage buses
HYDRO_BUS_SUFFIXES = ('Open loop pumping', 'Pondage', 'Reservoir', 'Closed loop pumping')


def hydro_buses(network):
    """Names of the hydro storage buses (name ends with one of HYDRO_BUS_SUFFIXES, case-insensitive)."""
    buses = next((c for c in network.components.values() if getattr(c, 'name', '') == 'Bus'), None)
    if buses is None or buses.static.empty:
        return []
    suffixes = tuple(s.lower() for s in HYDRO_BUS_SUFFIXES)
    return [str(b) for b in buses.static.index if str(b).strip().lower().endswith(suffixes)]


def _dense_attribute(comp, attr, snapshots):
    """
    Return a snapshots x components DataFrame for ``attr``, using the timeseries
    value where one exists and falling back to the static value otherwise.
    Inactive components are dropped.
    """
    static = comp.static
    if 'active' in static.columns:
        static = static[static['active'].astype(bool)]
    if static.empty:
        return pd.DataFrame(index=snapshots)

    base = static[attr] if attr in static.columns else pd.Series(0.0, index=static.index)
    dense = pd.DataFrame(
        [base.astype(float).values] * len(snapshots),
        index=snapshots, columns=static.index
    )

    ts = dict(comp.dynamic.items()).get(attr)
    if ts is not None and not ts.empty:
        cols = ts.columns.intersection(dense.columns)
        dense[cols] = ts[cols].reindex(snapshots).astype(float).values
    return dense.fillna(0.0)


def _has_results(comp, attr='p'):
    """True if the component has a non-empty (i.e. optimised) timeseries for ``attr``."""
    ts = dict(comp.dynamic.items()).get(attr)
    return ts is not None and not ts.empty


def _component_series(comp_key, comp, attr, snapshots):
    """
    Describe the per-component timeseries of ``attr`` for the active components.

    If the exported component timeseries already covers every active component,
    only a reference ``[comp_key, attr]`` is returned so the data is not
    duplicated in the HTML. Otherwise the dense (static-filled) values are included.
    """
    static = comp.static
    if 'active' in static.columns:
        static = static[static['active'].astype(bool)]
    names = [str(n) for n in static.index]

    ts = dict(comp.dynamic.items()).get(attr)
    if ts is not None and not ts.empty and set(static.index) <= set(ts.columns):
        return {'component': comp_key, 'names': names, 'ref': [comp_key, attr], 'series': None}

    dense = _dense_attribute(comp, attr, snapshots)
    return {
        'component': comp_key,
        'names': names,
        'ref': None,
        'series': {str(c): dense[c].tolist() for c in dense.columns},
    }


def extract_balance(network, time_index):
    """
    Build the per-component series used by the Power Balance tab.
    Returns None if the network has no loads and no generators.
    """
    snapshots = network.snapshots
    comps = {getattr(c, 'name', k): (k, c) for k, c in network.components.items()}
    loads_key, loads = comps.get('Load', (None, None))
    gens_key, gens = comps.get('Generator', (None, None))
    storage_units = comps.get('StorageUnit', (None, None))
    stores = comps.get('Store', (None, None))
    links_key, links = comps.get('Link', (None, None))
    _, buses = comps.get('Bus', (None, None))

    has_loads = loads is not None and not loads.static.empty
    has_gens = gens is not None and not gens.static.empty
    if not has_loads and not has_gens:
        return None

    balance = {
        'time_index': time_index,
        'unit': 'MW',
        'loads': None,
        'load_source': None,
        'generators': None,
        'storage': None,
        'links': None,
        'buses': [],
        'hydro_buses': [],
        'hydro_suffixes': list(HYDRO_BUS_SUFFIXES),
    }

    if buses is not None and not buses.static.empty:
        balance['buses'] = [str(b) for b in buses.static.index]
        balance['hydro_buses'] = hydro_buses(network)

    # Link flows at every port (bus0, bus1, bus2, ...) for the Imports / Exports views
    if links is not None and not links.static.empty and _has_results(links, 'p0'):
        dynamic = dict(links.dynamic.items())
        ports = []
        i = 0
        while f'bus{i}' in links.static.columns:
            ts = dynamic.get(f'p{i}')
            if ts is not None and not ts.empty:
                entry = _component_series(links_key, links, f'p{i}', snapshots)
                entry['bus_attr'] = f'bus{i}'
                ports.append(entry)
            i += 1
        balance['links'] = {'component': links_key, 'ports': ports}

    if has_loads:
        # Optimised load 'p' if available, otherwise the p_set input
        attr = 'p' if _has_results(loads) else 'p_set'
        balance['loads'] = _component_series(loads_key, loads, attr, snapshots)
        balance['load_source'] = attr

    if has_gens and _has_results(gens):
        balance['generators'] = _component_series(gens_key, gens, 'p', snapshots)

    # Storage units and stores: p > 0 is discharge into the bus, p < 0 is charging
    storage_entries = []
    for key, comp in (storage_units, stores):
        if comp is not None and not comp.static.empty and _has_results(comp):
            storage_entries.append(_component_series(key, comp, 'p', snapshots))
    balance['storage'] = storage_entries or None

    return balance
