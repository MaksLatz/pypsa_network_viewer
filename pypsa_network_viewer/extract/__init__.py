"""
Extraction of everything the viewer page shows from a PyPSA network, as plain
JSON-serialisable data. One module per part of the page:

- ``components``   : static tables, timeseries, network details, global constraints, carrier colours
- ``balance``      : per-component series for the Power Balance tab (and hydro bus detection)
- ``custom_plots`` : user-supplied Plotly figures
- ``explore``      : the ``n.explore()`` map
- ``statistics``   : the ``n.statistics`` methods for the Statistics tab
"""

import pandas as pd

from .balance import HYDRO_BUS_SUFFIXES, HYDRO_GENERATOR_CARRIERS, extract_balance, hydro_buses
from .components import (extract_carrier_colors, extract_components, extract_global_constraints,
                         extract_network_info)
from .custom_plots import extract_custom_plots
from .explore import extract_explore
from .statistics import extract_statistics


def _snapshot_info(network):
    """Time axis of the network: timestamps, their investment periods (multi-index only) and range."""
    snapshots = network.snapshots
    if isinstance(snapshots, pd.MultiIndex):
        ts_level = snapshots.get_level_values(1)
        try:
            time_index = ts_level.strftime('%Y-%m-%d %H:%M:%S').tolist()
        except AttributeError:
            time_index = [str(t) for t in ts_level]
        period_values = snapshots.get_level_values(0)
        return {
            'is_multi_index': True,
            'time_index': time_index,
            'period_index': [str(p) for p in period_values],
            'periods': [str(p) for p in period_values.unique()],
            'time_range': {'start': str(ts_level[0]), 'end': str(ts_level[-1]), 'periods': len(snapshots)},
        }
    return {
        'is_multi_index': False,
        'time_index': snapshots.strftime('%Y-%m-%d %H:%M:%S').tolist(),
        'period_index': None,
        'periods': None,
        'time_range': {'start': str(snapshots[0]), 'end': str(snapshots[-1]), 'periods': len(snapshots)},
    }


def extract_network_data(network, currency='$', custom_plots=None, bus_size=None,
                         hydro_bus_suffixes=HYDRO_BUS_SUFFIXES, hydro_generator_carriers=HYDRO_GENERATOR_CARRIERS):
    """
    Collect the data of the viewer page. Components are discovered dynamically from
    ``network.components`` (new components API): no hard-coded component lists.
    """
    hydro_bus_suffixes = tuple(hydro_bus_suffixes or ())
    hydro_generator_carriers = tuple(str(c).lower() for c in (hydro_generator_carriers or ()))
    snap = _snapshot_info(network)
    summary, components, component_classes = extract_components(
        network, snap['time_index'], snap['time_range'], currency)

    data = {
        # Snapshots (timestamps), stored once for every timeseries of the page
        'time_index': snap['time_index'],
        'summary': summary,
        'components': components,
        'component_classes': component_classes,
        # Hydro buses are also used by the Custom Plots filters, which work without the balance data
        'hydro_buses': hydro_buses(network, hydro_bus_suffixes),
        'hydro_suffixes': list(hydro_bus_suffixes),
        'hydro_generator_carriers': list(hydro_generator_carriers),
        'balance': extract_balance(network, snap['time_index'], hydro_bus_suffixes),
        'carrier_colors': extract_carrier_colors(network),
        'explore': extract_explore(network, bus_size=bus_size),
        'statistics': extract_statistics(network, currency),
        'custom_plots': {},
    }

    summary['snapshots'] = len(network.snapshots)
    summary['is_multi_index'] = snap['is_multi_index']
    if snap['is_multi_index']:
        summary['periods'] = snap['periods']
        summary['period_index'] = snap['period_index']
    summary['network_info'] = extract_network_info(network)

    global_constraints = extract_global_constraints(network)
    if global_constraints:
        summary['global_constraints'] = global_constraints

    if custom_plots is not None:
        plots_by_name, plot_names = extract_custom_plots(custom_plots, network)
        data['custom_plots'] = plots_by_name
        summary['custom_plots'] = plot_names

    return data
