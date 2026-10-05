"""Network Components and Network Summary data: static tables, timeseries, metadata, constraints."""

import re


def extract_components(network, time_index, time_range, currency='$'):
    """
    Static attributes and timeseries of every non-empty component.

    Returns (summary, components, component_classes):
    - summary: {component key: number of components}
    - components: {component key: {'static': {attr: {name: str}}, 'timeseries': {attr: {...}}}}
    - component_classes: {class name, e.g. 'Generator': component key, e.g. 'generators'}
    """
    summary, components, classes = {}, {}, {}
    for comp_name, comp in network.components.items():
        static_df = comp.static
        if static_df.empty:
            continue

        summary[comp_name] = len(static_df)
        classes[getattr(comp, 'name', comp_name)] = comp_name
        entry = components[comp_name] = {'static': {}, 'timeseries': {}}

        for col in static_df.columns:
            entry['static'][col] = {str(k): str(v) for k, v in static_df[col].to_dict().items()}

        for attr_name, ts_df in comp.dynamic.items():
            if ts_df.empty:
                continue
            entry['timeseries'][attr_name] = {
                'data': {str(col): ts_df[col].tolist() for col in ts_df.columns},
                'time_index': time_index,
                'time_range': time_range,
                'unit': unit_for_attribute(attr_name, currency=currency),
            }
    return summary, components, classes


def extract_network_info(network):
    """Network-level metadata shown under Network Details."""
    info = {
        'Network Name': network.name or '(unnamed)',
        'PyPSA Version': network.pypsa_version,
        'Objective': str(network.objective),
        'Objective Constant': str(getattr(network, '_objective_constant', 'N/A')),
        'Linearised Unit Commitment': str(getattr(network, '_linearized_uc', 'N/A')),
        'Multi Invest': str(getattr(network, '_multi_invest', 'N/A')),
        'SRID': str(network.srid),
    }
    if hasattr(network, 'meta') and network.meta:
        for key, value in network.meta.items():
            info[f'Metadata - {key}'] = str(value)
    return info


def extract_global_constraints(network):
    """Global constraints as a list of row dicts (empty list if there are none)."""
    gc = network.components.get('global_constraints')
    if gc is None or gc.static.empty:
        return []
    rows = []
    for idx, row in gc.static.iterrows():
        entry = {'name': idx}
        for col in gc.static.columns:
            entry[col] = (
                f"{row[col]:.2f}" if col == 'mu' and row[col] is not None
                else str(row[col]) if row[col] is not None
                else 'N/A'
            )
        rows.append(entry)
    return rows


def extract_carrier_colors(network):
    """Return {carrier: CSS colour} from the static ``color`` attribute of the carriers."""
    carriers = next((c for c in network.components.values() if getattr(c, 'name', '') == 'Carrier'), None)
    if carriers is None or carriers.static.empty or 'color' not in carriers.static.columns:
        return {}
    colors = {}
    for carrier, color in carriers.static['color'].items():
        if not isinstance(color, str) or not color.strip():
            continue
        color = color.strip()
        # Accept hex colours written without the leading '#'
        if re.fullmatch(r'[0-9a-fA-F]{6}|[0-9a-fA-F]{3}', color):
            color = '#' + color
        colors[str(carrier)] = color
    return colors


def unit_for_attribute(attr, currency='$'):
    """Return a human-readable unit string for a known timeseries attribute."""
    unit_map = {
        'p': 'MW', 'q': 'MVAr',
        'p0': 'MW', 'p1': 'MW', 'p2': 'MW', 'p3': 'MW', 'p4': 'MW',
        'q0': 'MVAr', 'q1': 'MVAr',
        'p_set': 'MW', 'q_set': 'MVAr',
        'e': 'MWh', 'e_set': 'MWh',
        'state_of_charge': 'MWh',
        'v_mag_pu': 'p.u.', 'v_ang': 'rad',
        'p_max_pu': 'p.u.', 'p_min_pu': 'p.u.',
        'e_max_pu': 'p.u.', 'e_min_pu': 'p.u.',
        's_max_pu': 'p.u.',
        'efficiency': 'p.u.', 'efficiency2': 'p.u.', 'efficiency3': 'p.u.',
        'marginal_cost': f'{currency}/MWh',
        'marginal_price': f'{currency}/MWh',
        'standing_loss': 'p.u.',
    }
    return unit_map.get(attr, 'Value')
