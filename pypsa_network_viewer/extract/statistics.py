"""
Statistics tab data: every ``network.statistics`` method, computed at export time.

Each statistic is exported grouped by component and carrier (PyPSA's default index, e.g. with an extra
bus_carrier level for energy_balance) and across components (``aggregate_across_components=True``), so
averages such as the market value are computed by PyPSA rather than summed. Prices are per bus. A
statistic that cannot be computed carries an error message instead of rows; it never stops the export.

Each statistic is also exported per bus (``by_bus``), for the viewer's Node and hydro bus filters: values for
additive statistics, numerator and denominator for averages (see AVERAGE_STATISTICS). It is only exported when it
adds up to PyPSA's own totals; otherwise ``by_bus_note`` says why and the viewer shows the whole network.
"""

import inspect

from .encoding import encode_json

# Shown by default in the Statistics tab (the "market set"); the others can be added with the selector
DEFAULT_STATISTICS = ('supply', 'revenue', 'market_value', 'prices', 'system_cost')

# key: (title, unit kind, explanation). Methods not listed here are still exported, with their name as
# title and the first line of their docstring as explanation.
STATISTICS_INFO = {
    'supply': ('Energy Supply', 'energy',
               'Energy delivered to the buses over all snapshots (weighted), per carrier. Lines and links appear '
               'with the energy they deliver at their receiving end.'),
    'withdrawal': ('Energy Withdrawal', 'energy', 'Energy taken from the buses over all snapshots (weighted), per carrier.'),
    'energy_balance': ('Energy Balance', 'energy',
                       'Supply (+) and withdrawal (−) per carrier and bus carrier, over all snapshots.'),
    'curtailment': ('Curtailment', 'energy', 'Energy that was available (p_max_pu) but not used, over all snapshots.'),
    'transmission': ('Transmission', 'energy', 'Energy transported by lines and links over all snapshots.'),
    'capacity_factor': ('Capacity Factor', 'ratio', 'Average output divided by the optimal capacity (0 to 1).'),
    'installed_capacity': ('Installed Capacity', 'capacity', 'Capacity before the optimisation (p_nom / s_nom / e_nom).'),
    'optimal_capacity': ('Optimal Capacity', 'capacity', 'Capacity after the optimisation (p_nom_opt / s_nom_opt / e_nom_opt).'),
    'expanded_capacity': ('Expanded Capacity', 'capacity', 'Capacity added by the optimisation (optimal − installed).'),
    'capex': ('Capital Cost', 'money', 'Annualised capital cost of the optimal capacities.'),
    'installed_capex': ('Installed Capital Cost', 'money', 'Annualised capital cost of the installed capacities.'),
    'expanded_capex': ('Expanded Capital Cost', 'money', 'Annualised capital cost of the expanded capacities.'),
    'overnight_cost': ('Overnight Cost', 'money', 'Overnight (not annualised) investment cost.'),
    'fom': ('Fixed O&M Cost', 'money', 'Fixed operation and maintenance cost.'),
    'opex': ('Operational Cost', 'money', 'Operational (marginal, start-up, ...) cost over all snapshots.'),
    'system_cost': ('System Cost', 'money', 'Annualised capital cost of the optimal capacities plus operational cost, per carrier.'),
    'revenue': ('Revenue', 'money',
                'Market revenue: dispatch × nodal price, summed over the snapshots. Consumers (e.g. loads) appear '
                'with negative revenue, i.e. what they pay.'),
    'market_value': ('Market Value', 'price',
                     'Average price earned per unit of energy (revenue ÷ supply): what one MWh of each carrier is worth on the market.'),
    'prices': ('Prices by Bus', 'price', "Average marginal price at each bus, as computed by PyPSA's n.statistics.prices()."),
}



# Averages (not additive): exported per bus as numerator and denominator, so the viewer can recompute them for
# any selection of nodes / carriers as sum(numerator) / sum(denominator).
#   market_value = revenue / |dispatch|   -> numerator: revenue; denominator: revenue / market value
#   capacity_factor = mean output / capacity -> denominator: optimal capacity; numerator: factor x capacity
AVERAGE_STATISTICS = {
    'market_value': lambda stats, value, **kw: (_call(stats.revenue, **kw), None),
    'capacity_factor': lambda stats, value, **kw: (None, _call(stats.optimal_capacity, **kw)),
}


def _call(method, **kwargs):
    """Call a statistics method unrounded; older PyPSA versions without `round` are called without it."""
    try:
        return method(round=None, **kwargs)
    except TypeError:
        return method(**kwargs)


def _by_bus(stats, key, by_component, by_carrier):
    """
    The statistic per component, bus and carrier (plus its other levels, e.g. bus_carrier), as
    ({'levels', 'encoded': rows [[level values..., value(, numerator, denominator)]], 'average', 'differs'}, None), or
    (None, reason) when it cannot be split by bus or the split does not add up to PyPSA's own totals.
    """
    import numpy as np
    import pandas as pd

    levels_default = list(by_component.index.names)
    if 'bus' in levels_default or 'carrier' not in levels_default:
        return None, None  # already per bus, or not per carrier (e.g. prices: per bus)
    groupby = ['bus'] + [level for level in levels_default if level != 'component']
    method = getattr(stats, key)
    try:
        value = _call(method, groupby=groupby)
        if not hasattr(value, 'dropna') or getattr(value, 'ndim', 1) != 1 or 'bus' not in value.index.names:
            return None, 'PyPSA cannot split this statistic by bus'
        average = key in AVERAGE_STATISTICS
        if average:
            num, den = AVERAGE_STATISTICS[key](stats, value, groupby=groupby)
            if num is not None:  # numerator given: denominator = numerator / value where defined
                index = num.index.union(value.index)
                num = num.reindex(index).fillna(0.0)
                ratio = value.reindex(index)
                den = (num / ratio).where(np.isfinite(num / ratio) & (ratio != 0), 0.0)
            else:                # denominator given: numerator = value x denominator
                index = value.index.union(den.index)
                den = den.reindex(index).fillna(0.0)
                num = (value.reindex(index) * den).fillna(0.0)
            value = (num / den).where(den != 0)
            frame = pd.DataFrame({'value': value, 'num': num, 'den': den})
            frame = frame[(frame['num'] != 0) | (frame['den'] != 0)]
        else:
            frame = pd.DataFrame({'value': value.dropna()})
    except Exception as e:
        return None, f'could not be split by bus ({type(e).__name__})'

    # The split must reproduce PyPSA's totals per component & carrier and per carrier
    def mismatches(reference):
        """Index entries of `reference` that the split does not reproduce (None: levels missing)."""
        ref_levels = list(reference.index.names)
        if not set(ref_levels) <= set(frame.index.names):
            return None
        grouped = frame.groupby(level=ref_levels).sum()
        mine = grouped['num'] / grouped['den'] if average else grouped['value']
        bad = []
        for idx, ref in reference.dropna().items():
            got = mine.get(idx, 0.0)
            if not np.isfinite(got) or abs(got - ref) > 1e-4 * abs(ref) + 0.02:
                bad.append(idx)
        return bad

    if mismatches(by_component) != []:
        return None, 'the values per bus do not add up to the totals of PyPSA'
    # Across components, an average can differ from PyPSA's when PyPSA divides by quantities without revenue,
    # e.g. the energy level of Stores in market_value: those carriers are listed, the viewer notes them
    differs = []
    if by_carrier is not None:
        bad = mismatches(by_carrier)
        if bad is None or (bad and not average):
            return None, 'the values per bus do not add up to the totals of PyPSA'
        differs = sorted({str(idx[0] if isinstance(idx, tuple) else idx) for idx in bad})
    levels = list(frame.index.names)
    columns = ['value', 'num', 'den'] if average else ['value']
    number = lambda v: float(v) if np.isfinite(v) else None
    rows = [[*(str(p) for p in (idx if isinstance(idx, tuple) else (idx,))), *(number(v) for v in vals)]
            for idx, vals in zip(frame.index, frame[columns].to_numpy())]
    # Rows compressed (large networks: thousands of rows per statistic); decoded by the page on first use
    return {'levels': levels, 'encoded': encode_json(rows), 'average': average, 'differs': differs}, None


def _rows(series):
    """Series -> (level names, list of row dicts with those levels and 'value'); NaN dropped."""
    levels = [name or f'level_{i}' for i, name in enumerate(series.index.names)]
    rows = []
    for idx, value in series.dropna().items():
        idx = idx if isinstance(idx, tuple) else (idx,)
        row = {level: str(part) for level, part in zip(levels, idx)}
        row['value'] = float(value)
        rows.append(row)
    return levels, rows


def _statistics_methods(network):
    """Names of the statistics methods: the known ones first (defaults, then the others), then any new ones."""
    stats = network.statistics
    # (PyPSA's statistics are callable objects, not always plain methods)
    available = [m for m in dir(stats) if not m.startswith('_') and callable(getattr(stats, m, None))
                 and not inspect.isclass(getattr(stats, m, None))]
    known = [m for m in (*DEFAULT_STATISTICS, *STATISTICS_INFO) if m in available]
    return list(dict.fromkeys(known + sorted(m for m in available if m not in STATISTICS_INFO)))


def extract_statistics(network, currency='$'):
    """
    {'default': [keys shown at first], 'items': [{key, title, unit, description, additive,
    by_component: {levels, rows}, by_carrier: {levels, rows}, error}]}
    """
    units = {'energy': 'MWh', 'capacity': 'MW', 'money': currency, 'price': f'{currency}/MWh', 'ratio': 'p.u.',
             None: ''}
    gens = dict(network.components.generators.dynamic.items())
    solved = 'p' in gens and not gens['p'].empty  # the statistics need dispatch results
    items = []
    for key in _statistics_methods(network):
        method = getattr(network.statistics, key)
        doc = next((line.strip() for line in (method.__doc__ or '').splitlines() if line.strip()), '')
        title, kind, description = STATISTICS_INFO.get(key, (key.replace('_', ' ').title(), None, doc))
        entry = {'key': key, 'title': title, 'unit': units[kind], 'unit_kind': kind, 'description': description,
                 # a total row makes sense for energies and costs; not for averages, ratios, revenue (~0) or balances
                 'additive': kind in ('energy', 'money') and key not in ('revenue', 'energy_balance'),
                 'by_component': {'levels': [], 'rows': []}, 'by_carrier': {'levels': [], 'rows': []},
                 'by_bus': None, 'by_bus_note': None, 'error': None}
        if not solved:
            entry['error'] = 'No optimisation results: run network.optimize() before exporting.'
            items.append(entry)
            continue
        try:
            result = method()
            if not hasattr(result, 'dropna') or getattr(result, 'ndim', 1) != 1:
                raise TypeError(f'returned {type(result).__name__}, not a series')
            levels, rows = _rows(result)
            entry['by_component'] = {'levels': levels, 'rows': rows}
            aggregated = None
            if 'component' in levels:
                aggregated = method(aggregate_across_components=True)
                levels, rows = _rows(aggregated)
                entry['by_carrier'] = {'levels': levels, 'rows': rows}
            else:  # e.g. prices: per bus, no component level
                entry['by_carrier'] = entry['by_component']
            if not entry['by_component']['rows']:
                entry['error'] = 'PyPSA returned no values for this statistic.'
            else:
                # Per bus, for the Node and hydro bus filters of the viewer
                entry['by_bus'], entry['by_bus_note'] = _by_bus(network.statistics, key, result, aggregated)
        except Exception as e:  # e.g. not available for this kind of network
            entry['error'] = f'Could not be computed: {type(e).__name__}: {e}'
        items.append(entry)
    return {'default': [k for k in DEFAULT_STATISTICS if any(i['key'] == k for i in items)], 'items': items}
