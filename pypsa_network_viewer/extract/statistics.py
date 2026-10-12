"""
Statistics tab data: five ``network.statistics`` results (market set), computed at export time.

Each statistic is exported grouped by (component, carrier) and by carrier. The per-carrier values come
from PyPSA itself (``aggregate_across_components=True``), so averages such as the market value are
correct rather than summed. Prices are per bus. A statistic that cannot be computed carries an error
message instead of rows; it never stops the export.
"""

# key, title, unit kind, explanation shown on the card
STATISTICS = (
    ('supply', 'Energy Supply', 'energy',
     'Energy delivered to the buses over all snapshots (weighted), per carrier. Lines and links appear '
     'with the energy they deliver at their receiving end.'),
    ('revenue', 'Revenue', 'money',
     'Market revenue: dispatch × nodal price, summed over the snapshots. Consumers (e.g. loads) appear '
     'with negative revenue, i.e. what they pay.'),
    ('market_value', 'Market Value', 'price',
     'Average price earned per unit of energy (revenue ÷ supply): what one MWh of each carrier is worth on the market.'),
    ('prices', 'Prices by Bus', 'price',
     "Average marginal price at each bus, as computed by PyPSA's n.statistics.prices()."),
    ('system_cost', 'System Cost', 'money',
     'Annualised capital cost of the optimal capacities plus operational cost, per carrier.'),
)


def _rows(series, levels):
    """Series -> list of row dicts with the given index level names and 'value' (NaN dropped)."""
    rows = []
    for idx, value in series.dropna().items():
        idx = idx if isinstance(idx, tuple) else (idx,)
        row = {level: str(part) for level, part in zip(levels, idx)}
        row['value'] = float(value)
        rows.append(row)
    return rows


def extract_statistics(network, currency='$'):
    """List of the five statistics, each {key, title, unit, description, by_component, by_carrier, error}."""
    units = {'energy': 'MWh', 'money': currency, 'price': f'{currency}/MWh'}
    gens = dict(network.components.generators.dynamic.items())
    solved = 'p' in gens and not gens['p'].empty  # the statistics need dispatch results
    out = []
    for key, title, kind, description in STATISTICS:
        entry = {'key': key, 'title': title, 'unit': units[kind], 'description': description,
                 'by_component': [], 'by_carrier': [], 'error': None}
        if not solved:
            entry['error'] = 'No optimisation results: run network.optimize() before exporting.'
            out.append(entry)
            continue
        try:
            method = getattr(network.statistics, key)
            if key == 'prices':
                entry['by_carrier'] = _rows(method(), ['bus'])  # per bus, no grouping
            else:
                entry['by_component'] = _rows(method(), ['component', 'carrier'])
                entry['by_carrier'] = _rows(method(aggregate_across_components=True), ['carrier'])
            if not entry['by_carrier'] and not entry['by_component']:
                entry['error'] = 'PyPSA returned no values for this statistic.'
        except Exception as e:  # e.g. not available for this kind of network
            entry['error'] = f'Could not be computed: {type(e).__name__}: {e}'
        out.append(entry)
    return out
