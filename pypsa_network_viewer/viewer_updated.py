"""
PyPSA Network Viewer
Interactive HTML visualization for PyPSA networks

Author: Priyesh Gosai
"""

import importlib.util
import json
import os
import re
import sys

import pandas as pd
import pypsa

_PYPSA_MAJOR = int(pypsa.__version__.split('.')[0])
if _PYPSA_MAJOR < 1:
    raise ImportError(
        f"pypsa_network_viewer requires PyPSA >= 1.0.0, but {pypsa.__version__} is installed"
    )

pypsa.options.api.new_components_api = True

# Buses whose name ends with one of these suffixes are hydro storage buses
HYDRO_BUS_SUFFIXES = ('Open loop pumping', 'Pondage', 'Reservoir', 'Closed loop pumping')


def html_network(network, file_path=None, file_name=None, title="PyPSA Network Analyzer",
                 currency='$', custom_plots=None):
    """
    Generate interactive HTML interface for exploring PyPSA network components and timeseries data.

    Parameters:
    -----------
    network : pypsa.Network
        The PyPSA network object to analyze
    file_path : str, optional
        Directory path where the HTML file should be saved (default: None, saves in current directory)
    file_name : str, optional
        Name of the HTML file (default: None, creates "network_analyzer.html")
    title : str, optional
        Title for the HTML page (default: "PyPSA Network Analyzer")
    currency : str, optional
        Currency symbol for cost displays (default: '$')
    custom_plots : str or list, optional
        Either a path to a Python file containing a ``get_plots(network)`` function that
        returns a list of Plotly figure objects, OR a list of Plotly figure objects directly.
        See ``custom_plots_template.py`` for the expected file format.

    Returns:
    --------
    str : Path to generated HTML file

    Examples:
    ---------
    Basic usage:
    >>> import pypsa
    >>> network = pypsa.examples.ac_dc_meshed()
    >>> network.optimize()
    >>> html_network(network, file_name='my_network.html')

    With a custom plots file:
    >>> html_network(network, file_name='full_network.html',
    ...              currency='€', custom_plots='my_custom_plots.py')

    With inline custom plots:
    >>> import plotly.graph_objects as go
    >>> fig = go.Figure()
    >>> html_network(network, custom_plots=[fig])
    """

    if file_name is None:
        file_name = "network_analyzer.html"

    if file_path is None:
        output_file = file_name
    else:
        output_file = os.path.join(file_path, file_name)

    component_info = _extract_component_info(network, currency=currency, custom_plots=custom_plots)

    data_json = json.dumps(component_info, indent=2, default=str)

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/plotly.js/2.26.0/plotly.min.js"></script>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #2c3e50 0%, #4a6741 100%);
            min-height: 100vh;
        }}
        .container {{
            max-width: 1800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }}
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #eee;
        }}
        .header h1 {{
            color: #2c3e50;
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }}
        .header p {{
            color: #7f8c8d;
            font-size: 1.1em;
            margin-top: 10px;
        }}
        .controls-section {{
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
            padding: 25px;
            background: #f8f9fa;
            border-radius: 10px;
            border-left: 4px solid #2c3e50;
        }}
        .control-group {{
            display: flex;
            flex-direction: column;
        }}
        .control-label {{
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 8px;
            font-size: 1.1em;
        }}
        select, button {{
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 1em;
            transition: all 0.2s;
        }}
        select:focus, button:hover {{
            outline: none;
            border-color: #2c3e50;
        }}
        button {{
            background: linear-gradient(135deg, #2c3e50 0%, #4a6741 100%);
            color: white;
            border: none;
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(44, 62, 80, 0.3);
        }}
        button:hover {{
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(44, 62, 80, 0.4);
        }}
        .content-area {{
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            min-height: 600px;
        }}
        .loading {{
            display: none;
            text-align: center;
            color: #2c3e50;
            font-size: 1.2em;
            padding: 50px;
        }}
        .data-table {{
            overflow-x: auto;
            margin-top: 20px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }}
        th {{
            background: #2c3e50;
            color: white;
            font-weight: 600;
        }}
        tr:hover {{
            background: #f5f5f5;
        }}
        .plot-container {{
            margin-top: 20px;
        }}
        .info-panel {{
            background: #e8f4f8;
            border: 1px solid #bee5eb;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }}
        .info-panel h3 {{
            margin: 0 0 10px 0;
            color: #2c3e50;
        }}
        .error-panel {{
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
            color: #721c24;
        }}
        .network-summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }}
        .summary-card {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }}
        .summary-card h3 {{
            margin: 0 0 10px 0;
            color: #2c3e50;
            font-size: 1.8em;
        }}
        .summary-card p {{
            margin: 0;
            color: #7f8c8d;
            font-size: 0.9em;
        }}
        .network-details {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            margin-top: 20px;
        }}
        .network-details-item {{
            display: grid;
            grid-template-columns: 250px 1fr;
            padding: 10px 0;
            border-bottom: 1px solid #eee;
        }}
        .network-details-label {{
            font-weight: 600;
            color: #2c3e50;
        }}
        .network-details-value {{
            color: #555;
        }}
        .filter-bar {{
            display: flex;
            flex-wrap: wrap;
            align-items: flex-end;
            gap: 15px;
            background: white;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }}
        .filter-bar .control-group {{
            min-width: 180px;
        }}
        .filter-bar .control-label {{
            font-size: 0.95em;
        }}
        .filter-bar .filter-count {{
            color: #7f8c8d;
            padding-bottom: 12px;
        }}
        .filter-bar button {{
            padding: 10px 16px;
        }}
        .filter-title {{
            flex-basis: 100%;
            font-weight: 700;
            color: #2c3e50;
            font-size: 1.05em;
        }}
        .button-group {{
            display: flex;
            gap: 6px;
        }}
        .toggle-btn .swatch {{
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
            border: 1px solid white;
            vertical-align: middle;
        }}
        .swatch-inline {{
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 2px;
            margin: 0 6px 0 2px;
            vertical-align: middle;
            border: 1px solid rgba(0,0,0,0.2);
        }}
        .toggle-btn .caret {{
            margin-left: 8px;
            font-size: 0.85em;
        }}
        .group-panel {{
            border-left: 4px solid #2c3e50;
            border-radius: 8px;
            margin-bottom: 15px;
        }}
        .group-panel .filter-bar {{
            margin-bottom: 0;
            border-radius: 0 8px 8px 0;
        }}
        .group-panel .filter-bar + .filter-bar {{
            border-top: 1px solid #eee;
        }}
        .unit-bar {{
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 10px;
        }}
        .unit-bar .control-label {{
            margin-bottom: 0;
        }}
        .filter-note {{
            flex-basis: 100%;
            color: #7f8c8d;
            font-size: 0.9em;
        }}
        .multi-select {{
            position: relative;
        }}
        .filter-bar .multi-select-toggle,
        .multi-select-toggle {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            width: 100%;
            min-width: 180px;
            max-width: 260px;
            padding: 12px;
            background: white;
            color: #2c3e50;
            border: 2px solid #e0e0e0;
            box-shadow: none;
            font-weight: 400;
            text-align: left;
        }}
        .multi-select-toggle:hover {{
            transform: none;
            box-shadow: none;
            border-color: #2c3e50;
        }}
        .multi-select-summary {{
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }}
        .multi-select-menu {{
            display: none;
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            z-index: 100;
            min-width: 100%;
            max-width: 360px;
            background: white;
            border: 2px solid #2c3e50;
            border-radius: 8px;
            padding: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }}
        .multi-select.open .multi-select-menu {{
            display: block;
        }}
        .multi-select-search {{
            width: 100%;
            box-sizing: border-box;
            padding: 8px;
            margin-bottom: 6px;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
        }}
        .multi-select-options {{
            max-height: 260px;
            overflow-y: auto;
        }}
        .multi-select-option {{
            display: block;
            padding: 6px 4px;
            white-space: nowrap;
            cursor: pointer;
        }}
        .multi-select-option:hover {{
            background: #f5f5f5;
        }}
        .filter-bar .link-btn,
        .link-btn {{
            background: none;
            color: #2980b9;
            border: none;
            box-shadow: none;
            padding: 4px;
            font-weight: 600;
            font-size: 0.9em;
        }}
        .link-btn:hover {{
            transform: none;
            box-shadow: none;
            text-decoration: underline;
        }}
        .toggle-bar {{
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 15px;
        }}
        .toggle-btn {{
            background: white;
            color: #2c3e50;
            border: 2px solid #2c3e50;
            box-shadow: none;
            padding: 8px 16px;
        }}
        .toggle-btn.active {{
            background: linear-gradient(135deg, #2c3e50 0%, #4a6741 100%);
            color: white;
        }}
        .toggle-btn:disabled {{
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{title}</h1>
            <p>Interactive exploration of PyPSA network components and timeseries data</p>
        </div>

        <div id="networkSummary" class="network-summary">
            <!-- Will be populated by JavaScript -->
        </div>

        <div class="controls-section">
            <div class="control-group">
                <label class="control-label">Component Type</label>
                <select id="componentTypeSelect">
                    <option value="">Select component type...</option>
                </select>
            </div>
            <div class="control-group">
                <label class="control-label">Data Type</label>
                <select id="dataTypeSelect" disabled>
                    <option value="">Select data type...</option>
                    <option value="static">Static Data</option>
                    <option value="timeseries">Time Series</option>
                </select>
            </div>
            <div class="control-group">
                <label class="control-label">Time Series / Plot</label>
                <select id="timeseriesSelect" disabled>
                    <option value="">Select timeseries...</option>
                </select>
            </div>
        </div>

        <div class="controls-section">
            <div class="control-group" id="yearGroup" style="display:none;">
                <label class="control-label">Investment Period</label>
                <select id="yearSelect">
                    <option value="">All Periods</option>
                </select>
            </div>
            <div class="control-group">
                <button onclick="loadData()" id="loadButton" disabled>Load Data</button>
            </div>
            <div class="control-group">
                <button onclick="clearDisplay()" id="clearButton">Clear Display</button>
            </div>
        </div>

        <div class="content-area">
            <div class="loading" id="loading">Loading data...</div>
            <div id="contentDisplay">
                <div class="info-panel">
                    <h3>Welcome to PyPSA Network Analyzer</h3>
                    <p>Select a component type and data type above to begin exploring your network data.</p>
                    <p><strong>Instructions:</strong></p>
                    <ul>
                        <li>Choose a component type from the dropdown</li>
                        <li>Select whether you want to view static properties or timeseries data</li>
                        <li>For timeseries, choose which specific attribute to plot</li>
                        <li>Click "Load Data" to display the information</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>

    <script>
        const networkData = {data_json};

        let currentData = null;

        // Static attributes offered as timeseries filters, keyed by PyPSA component class
        const FILTER_CONFIG = {{
            Generator: [
                {{ attr: 'carrier', label: 'Carrier' }},
                {{ attr: 'type', label: 'Type' }},
                {{ attr: 'bus', label: 'Bus (node)' }}
            ],
            Load: [
                {{ attr: 'bus', label: 'Bus (node)' }}
            ],
            Link: [
                {{ attr: 'bus0', label: 'From bus (bus0)' }},
                {{ attr: 'bus1', label: 'To bus (bus1)' }}
            ]
        }};
        const FILTER_NOTES = {{
            Link: 'p0 &gt; 0 means power flows from bus0 to bus1; negative values indicate flow in the reverse direction.'
        }};
        const activeFilters = {{}};  // filter state key -> {{ attr: [selected values] }} (empty = All)
        let openMultiSelect = null;  // 'stateKey|attr' of the filter dropdown currently open
        const multiSelectSearch = {{}};  // 'stateKey|attr' -> search text

        // Power Balance toggle groups and display state
        // color links each button to its options panel and its plot line; hint is the button tooltip
        const BALANCE_GROUPS = [
            {{ key: 'load', label: 'Load', color: '#c0392b',
               hint: 'Power consumed by the loads at the selected nodes.' }},
            {{ key: 'generation', label: 'Generation', color: '#27ae60',
               hint: 'Power produced by the generators at the selected nodes. Opens generator filters and the carrier breakdown.' }},
            {{ key: 'imports', label: 'Imports', color: '#2980b9',
               hint: 'Net power reaching the selected nodes through links (into the node +, out of the node −). Hydro storage links are shown separately.' }},
            {{ key: 'storage', label: 'Storage (net)', color: '#8e44ad',
               hint: 'Storage units and stores at the selected nodes: discharge +, charging −.' }},
            {{ key: 'mismatch', label: 'Mismatch', color: '#2c3e50',
               hint: 'Balance check: Load − (Generation + Imports + Hydro storage + Storage). Should be zero; anything else is power not captured by these plots (e.g. AC line flows).' }}
        ];
        const HYDRO_COLOR = '#00acc1';
        const BALANCE_UNITS = {{ kW: 1000, MW: 1, GW: 0.001 }};
        const balanceState = {{
            visible: {{ load: true, generation: true, imports: false, storage: false, mismatch: false }},
            loadSplit: false,        // one load line per bus
            genSplit: false,         // one generation line per bus
            importSplit: false,      // one import line per bus
            showCarriers: false,     // add the generation-by-carrier breakdown
            carrierMode: 'stacked',  // 'lines' | 'stacked'
            stackStyle: 'filled',    // 'filled' | 'line'
            unit: 'MW'
        }};
        // Filter state keys for the Power Balance view (kept separate from the component tabs)
        const BALANCE_NODE_FILTERS = '__balance_nodes';  // shared node picker for all plots
        const BALANCE_GEN_FILTERS = '__balance_generators';
        const BUS_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                            '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
        const CARRIER_COLORED_CLASSES = ['Generator', 'StorageUnit', 'Store'];
        let balanceExport = null;  // what the Power Balance plot currently shows, for CSV download

        // Colour of a carrier: its static 'color' attribute, else a stable fallback from the palette
        function carrierColor(carrier) {{
            const colors = networkData.carrier_colors || {{}};
            if (colors[carrier]) return colors[carrier];
            let hash = 0;
            for (const ch of String(carrier)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
            return BUS_COLORS[hash % BUS_COLORS.length];
        }}

        document.addEventListener('DOMContentLoaded', function() {{
            populateNetworkSummary();
            populateComponentTypes();
            setupEventListeners();
            if (networkData.summary.is_multi_index) {{
                const yearGroup = document.getElementById('yearGroup');
                yearGroup.style.display = 'flex';
                const yearSelect = document.getElementById('yearSelect');
                networkData.summary.periods.forEach(p => {{
                    const opt = document.createElement('option');
                    opt.value = p;
                    opt.textContent = p;
                    yearSelect.appendChild(opt);
                }});
                if (networkData.summary.periods.length > 0) {{
                    yearSelect.value = networkData.summary.periods[0];
                }}
            }}
        }});

        function populateNetworkSummary() {{
            const summaryDiv = document.getElementById('networkSummary');
            const summary = networkData.summary;
            const skip = new Set(['network_info', 'global_constraints', 'custom_plots', 'is_multi_index', 'periods', 'period_index']);

            let html = '';
            Object.entries(summary).forEach(([key, value]) => {{
                if (!skip.has(key)) {{
                    html += `<div class="summary-card"><h3>${{value}}</h3><p>${{key.replace(/_/g, ' ').toUpperCase()}}</p></div>`;
                }}
            }});
            summaryDiv.innerHTML = html;
        }}

        function populateComponentTypes() {{
            const select = document.getElementById('componentTypeSelect');

            if (networkData.summary.network_info) {{
                const opt = document.createElement('option');
                opt.value = 'network_summary';
                opt.textContent = 'Network Summary';
                select.appendChild(opt);
            }}

            if (networkData.balance) {{
                const opt = document.createElement('option');
                opt.value = 'load_generation';
                opt.textContent = 'Power Balance';
                select.appendChild(opt);
            }}

            if (networkData.summary.global_constraints) {{
                const opt = document.createElement('option');
                opt.value = 'global_constraints';
                opt.textContent = 'Global Constraints';
                select.appendChild(opt);
            }}

            if (networkData.summary.custom_plots && networkData.summary.custom_plots.length > 0) {{
                const opt = document.createElement('option');
                opt.value = 'custom_plots';
                opt.textContent = 'Custom Plots';
                select.appendChild(opt);
            }}

            Object.keys(networkData.components).forEach(comp => {{
                const opt = document.createElement('option');
                opt.value = comp;
                opt.textContent = comp.charAt(0).toUpperCase() + comp.slice(1);
                select.appendChild(opt);
            }});
        }}

        function setupEventListeners() {{
            document.getElementById('componentTypeSelect').addEventListener('change', onComponentTypeChange);
            document.getElementById('dataTypeSelect').addEventListener('change', onDataTypeChange);
            document.getElementById('yearSelect').addEventListener('change', function() {{
                if (currentData && currentData.type === 'timeseries') {{
                    displayTimeseriesData(currentData.componentType, currentData.timeseriesName);
                }} else if (currentData && currentData.type === 'load_generation') {{
                    displayLoadGeneration();
                }}
            }});
        }}

        function onComponentTypeChange() {{
            const componentType = document.getElementById('componentTypeSelect').value;
            const dataTypeSelect = document.getElementById('dataTypeSelect');
            const timeseriesSelect = document.getElementById('timeseriesSelect');

            timeseriesSelect.innerHTML = '<option value="">Select timeseries...</option>';
            timeseriesSelect.disabled = true;

            if (componentType === 'network_summary' || componentType === 'global_constraints' || componentType === 'load_generation') {{
                dataTypeSelect.disabled = true;
                dataTypeSelect.value = '';
                document.getElementById('loadButton').disabled = false;
            }} else if (componentType === 'custom_plots') {{
                dataTypeSelect.disabled = false;
                dataTypeSelect.innerHTML = '<option value="">Select plot...</option>';
                networkData.summary.custom_plots.forEach(name => {{
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    dataTypeSelect.appendChild(opt);
                }});
                document.getElementById('loadButton').disabled = true;
            }} else if (componentType) {{
                dataTypeSelect.disabled = false;
                dataTypeSelect.innerHTML = '<option value="">Select data type...</option><option value="static">Static Data</option><option value="timeseries">Time Series</option>';
                dataTypeSelect.value = '';
                document.getElementById('loadButton').disabled = true;
            }} else {{
                dataTypeSelect.disabled = true;
                dataTypeSelect.innerHTML = '<option value="">Select data type...</option><option value="static">Static Data</option><option value="timeseries">Time Series</option>';
                document.getElementById('loadButton').disabled = true;
            }}
        }}

        function onDataTypeChange() {{
            const componentType = document.getElementById('componentTypeSelect').value;
            const dataType = document.getElementById('dataTypeSelect').value;
            const timeseriesSelect = document.getElementById('timeseriesSelect');

            if (componentType === 'custom_plots' && dataType) {{
                timeseriesSelect.disabled = true;
                document.getElementById('loadButton').disabled = false;
            }} else if (dataType === 'static') {{
                timeseriesSelect.disabled = true;
                timeseriesSelect.innerHTML = '<option value="">Select timeseries...</option>';
                document.getElementById('loadButton').disabled = false;
            }} else if (dataType === 'timeseries') {{
                const timeseries = networkData.components[componentType].timeseries;
                timeseriesSelect.innerHTML = '<option value="">Select timeseries...</option>';
                Object.keys(timeseries).forEach(ts => {{
                    const opt = document.createElement('option');
                    opt.value = ts;
                    opt.textContent = ts;
                    timeseriesSelect.appendChild(opt);
                }});
                timeseriesSelect.disabled = false;
                timeseriesSelect.onchange = function() {{
                    document.getElementById('loadButton').disabled = !this.value;
                }};
            }}
        }}

        function loadData() {{
            const componentType = document.getElementById('componentTypeSelect').value;
            const dataType = document.getElementById('dataTypeSelect').value;
            const timeseries = document.getElementById('timeseriesSelect').value;

            if (!componentType) return;

            showLoading(true);
            setTimeout(() => {{
                try {{
                    if (componentType === 'network_summary') {{
                        displayNetworkSummary();
                    }} else if (componentType === 'global_constraints') {{
                        displayGlobalConstraints();
                    }} else if (componentType === 'load_generation') {{
                        displayLoadGeneration();
                    }} else if (componentType === 'custom_plots' && dataType) {{
                        displayCustomPlot(dataType);
                    }} else if (dataType === 'static') {{
                        displayStaticData(componentType);
                    }} else if (dataType === 'timeseries' && timeseries) {{
                        displayTimeseriesData(componentType, timeseries);
                    }}
                }} catch (error) {{
                    showError('Error loading data: ' + error.message);
                }}
                showLoading(false);
            }}, 300);
        }}

        function displayNetworkSummary() {{
            const data = networkData.summary.network_info;
            const contentDiv = document.getElementById('contentDisplay');
            let html = '<div class="info-panel"><h3>Network Summary</h3></div><div class="network-details">';
            Object.entries(data).forEach(([key, value]) => {{
                html += `<div class="network-details-item"><div class="network-details-label">${{key}}</div><div class="network-details-value">${{value}}</div></div>`;
            }});
            html += '</div>';
            contentDiv.innerHTML = html;
            currentData = {{ type: 'network_summary', data }};
        }}

        function displayGlobalConstraints() {{
            const data = networkData.summary.global_constraints;
            const contentDiv = document.getElementById('contentDisplay');

            if (!data || data.length === 0) {{
                contentDiv.innerHTML = '<div class="error-panel"><strong>No global constraints available</strong></div>';
                return;
            }}

            const columns = Object.keys(data[0]);
            let html = `<div class="info-panel"><h3>Global Constraints</h3><p>Showing ${{data.length}} constraint(s)</p></div>
                <div class="data-table"><table><thead><tr>${{columns.map(c => `<th>${{c}}</th>`).join('')}}</tr></thead><tbody>`;
            data.forEach(row => {{
                html += '<tr>' + columns.map(c => `<td>${{row[c] ?? 'N/A'}}</td>`).join('') + '</tr>';
            }});
            html += '</tbody></table></div>';
            contentDiv.innerHTML = html;
            currentData = {{ type: 'global_constraints', data }};
        }}

        function displayCustomPlot(plotName) {{
            const plotData = networkData.custom_plots[plotName];
            const contentDiv = document.getElementById('contentDisplay');

            if (!plotData) {{
                contentDiv.innerHTML = '<div class="error-panel"><strong>Custom plot data not found</strong></div>';
                return;
            }}

            contentDiv.innerHTML = `
                <div class="info-panel"><h3>Custom Plot: ${{plotName}}</h3></div>
                <div class="plot-container"><div id="customPlot" style="width:100%;height:600px;"></div></div>`;

            Plotly.newPlot('customPlot', plotData.data, plotData.layout, {{
                responsive: true, displayModeBar: true, displaylogo: false
            }});
            currentData = {{ type: 'custom_plot', plotName, data: plotData }};
        }}

        function displayStaticData(componentType) {{
            const data = networkData.components[componentType].static;
            const contentDiv = document.getElementById('contentDisplay');

            if (!data || Object.keys(data).length === 0) {{
                contentDiv.innerHTML = `<div class="error-panel"><strong>No static data available for ${{componentType}}</strong></div>`;
                return;
            }}

            const columns = Object.keys(data);
            const indices = Object.keys(data[columns[0]] || {{}});

            let html = `<div class="info-panel"><h3>${{componentType.charAt(0).toUpperCase() + componentType.slice(1)}} - Static Data</h3>
                <p>Showing ${{indices.length}} components with ${{columns.length}} properties</p></div>
                <div class="data-table"><table><thead><tr><th>Component</th>
                ${{columns.map(c => `<th>${{c}}</th>`).join('')}}</tr></thead><tbody>`;

            indices.forEach(idx => {{
                html += `<tr><td><strong>${{idx}}</strong></td>` +
                    columns.map(c => `<td>${{data[c][idx] ?? 'N/A'}}</td>`).join('') + '</tr>';
            }});

            html += '</tbody></table></div>';
            contentDiv.innerHTML = html;
            currentData = {{ type: 'static', componentType, data }};
        }}

        function displayTimeseriesData(componentType, timeseriesName) {{
            const data = networkData.components[componentType].timeseries[timeseriesName];
            const contentDiv = document.getElementById('contentDisplay');

            if (!data || Object.keys(data.data).length === 0) {{
                contentDiv.innerHTML = `<div class="error-panel"><strong>No timeseries data for ${{componentType}} - ${{timeseriesName}}</strong></div>`;
                return;
            }}

            let {{ timeIndex, seriesData, periodLabel }} = applyPeriodFilter(data.time_index, data.data);

            // Attribute filters (carrier / type / bus for generators, bus0 / bus1 for links)
            const filterCfg = getFilterConfig(componentType);
            const totalSeries = Object.keys(seriesData).length;
            let filterValues = null;
            if (filterCfg) {{
                filterValues = cascadeFilterValues(componentType, componentType, filterCfg, Object.keys(seriesData));
                seriesData = applyAttributeFilters(componentType, componentType, filterCfg, seriesData);
            }}
            const shownSeries = Object.keys(seriesData).length;
            const filterHtml = filterCfg
                ? renderFilterBar(componentType, filterValues, totalSeries, shownSeries,
                    {{ id: 'timeseriesFilters', note: FILTER_NOTES[getComponentClass(componentType)] }})
                : '';

            contentDiv.innerHTML = `
                <div class="info-panel">
                    <h3>${{componentType.charAt(0).toUpperCase() + componentType.slice(1)}} - ${{timeseriesName}}${{periodLabel}}</h3>
                    <p><strong>Time Range:</strong> ${{data.time_range.start}} to ${{data.time_range.end}}</p>
                    <p><strong>Series:</strong> ${{shownSeries}} of ${{totalSeries}} with ${{timeIndex.length}} time steps shown</p>
                </div>
                ${{filterHtml}}
                <div class="plot-container">${{shownSeries === 0
                    ? '<div class="error-panel"><strong>No series match the selected filters.</strong></div>'
                    : '<div id="timeseriesPlot" style="width:100%;height:600px;"></div>'}}</div>`;

            currentData = {{ type: 'timeseries', componentType, timeseriesName, data }};
            if (filterCfg) {{
                bindFilterBar(document.getElementById('timeseriesFilters'), componentType,
                    () => displayTimeseriesData(componentType, timeseriesName));
            }}
            if (shownSeries === 0) return;

            // Generators and storage are coloured by their carrier's static colour (when defined)
            const carrierCol = CARRIER_COLORED_CLASSES.includes(getComponentClass(componentType))
                ? networkData.components[componentType].static.carrier : null;
            const colors = networkData.carrier_colors || {{}};
            const traces = Object.entries(seriesData).map(([name, values]) => {{
                const t = {{ x: timeIndex, y: values, type: 'scatter', mode: 'lines', name, line: {{ width: 2 }} }};
                const carrier = carrierCol ? carrierCol[name] : undefined;
                if (carrier && colors[carrier]) t.line.color = colors[carrier];
                return t;
            }});

            Plotly.newPlot('timeseriesPlot', traces, {{
                title: `${{componentType}} - ${{timeseriesName}}${{periodLabel}}`,
                xaxis: {{ title: 'Time', type: 'date' }},
                yaxis: {{ title: data.unit || 'Value' }},
                hovermode: 'x unified',
                legend: {{ orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 }},
                margin: {{ l: 80, r: 80, t: 80, b: 120 }}
            }}, {{ responsive: true, displayModeBar: true, displaylogo: false }});
        }}

        function escapeHtml(value) {{
            return String(value).replace(/[&<>"']/g, c => ({{
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }})[c]);
        }}

        // Multi-index: restrict a timeseries to the selected investment period
        function applyPeriodFilter(timeStrings, seriesDict) {{
            let timeIndex = timeStrings.map(t => new Date(t));
            let seriesData = seriesDict;
            let periodLabel = '';

            if (networkData.summary.is_multi_index) {{
                const selectedPeriod = document.getElementById('yearSelect').value;
                if (selectedPeriod) {{
                    const mask = networkData.summary.period_index.map(p => p === selectedPeriod);
                    timeIndex = timeIndex.filter((_, i) => mask[i]);
                    timeStrings = timeStrings.filter((_, i) => mask[i]);
                    seriesData = {{}};
                    Object.entries(seriesDict).forEach(([name, values]) => {{
                        seriesData[name] = values ? values.filter((_, i) => mask[i]) : values;
                    }});
                    periodLabel = ` — Period: ${{selectedPeriod}}`;
                }}
            }}
            return {{ timeIndex, timeStrings, seriesData, periodLabel }};
        }}

        function getComponentClass(componentType) {{
            const classes = networkData.component_classes || {{}};
            return Object.keys(classes).find(cls => classes[cls] === componentType) || null;
        }}

        // Filter definitions for a component, limited to attributes present in its static data
        function getFilterConfig(componentType) {{
            const cfg = FILTER_CONFIG[getComponentClass(componentType)];
            if (!cfg) return null;
            const staticData = networkData.components[componentType].static;
            const available = cfg.filter(f => staticData[f.attr]);
            return available.length > 0 ? available : null;
        }}

        // Keep entries of seriesData whose component matches the filters stored under stateKey.
        // Each filter holds a list of accepted values; an empty list means All.
        function applyAttributeFilters(stateKey, componentType, filterCfg, seriesData) {{
            const selected = activeFilters[stateKey] || {{}};
            const staticData = networkData.components[componentType].static;
            const result = {{}};
            Object.entries(seriesData).forEach(([name, values]) => {{
                const keep = filterCfg.every(f => {{
                    const wanted = selected[f.attr];
                    if (!wanted || wanted.length === 0) return true;
                    return wanted.includes(staticData[f.attr][name]);
                }});
                if (keep) result[name] = values;
            }});
            return result;
        }}

        // Attach the selectable values to each filter, cascading in filterCfg order: a filter only offers
        // values found among the components (from names) that match the filters before it, e.g. Type only
        // lists the types of the selected carrier(s). Selections that are no longer offered are dropped.
        // Call before applyAttributeFilters so the dropped selections are not applied.
        function cascadeFilterValues(stateKey, componentType, filterCfg, names) {{
            const staticData = networkData.components[componentType].static;
            const selected = activeFilters[stateKey] || {{}};
            let pool = names;
            return filterCfg.map(f => {{
                const col = staticData[f.attr];
                const values = [...new Set(pool.map(n => col[n]).filter(v => v !== undefined))].sort();
                if (selected[f.attr]) {{
                    selected[f.attr] = selected[f.attr].filter(v => values.includes(v));
                    if (selected[f.attr].length) {{
                        const keep = new Set(selected[f.attr]);
                        pool = pool.filter(n => keep.has(col[n]));
                    }}
                }}
                return {{ ...f, values }};
            }});
        }}

        // Checkbox dropdown allowing several values to be selected at once
        function renderMultiSelect(stateKey, f, chosen) {{
            const id = stateKey + '|' + f.attr;
            const search = multiSelectSearch[id] || '';
            const display = v => v === '' ? '(none)' : v;
            const summary = chosen.length === 0 ? 'All'
                : chosen.length <= 2 ? chosen.map(display).join(', ')
                : `${{chosen.length}} selected`;
            const options = f.values.map(v => {{
                const hidden = search && !display(v).toLowerCase().includes(search.toLowerCase());
                // Carrier options show the carrier's colour
                const swatch = f.attr === 'carrier' && v !== ''
                    ? `<span class="swatch-inline" style="background:${{escapeHtml(carrierColor(v))}}"></span>` : '';
                return `<label class="multi-select-option"${{hidden ? ' style="display:none"' : ''}}>
                    <input type="checkbox" value="${{escapeHtml(v)}}" ${{chosen.includes(v) ? 'checked' : ''}}> ${{swatch}}${{escapeHtml(display(v))}}</label>`;
            }}).join('');
            return `<div class="control-group">
                <label class="control-label">${{escapeHtml(f.label)}}</label>
                <div class="multi-select${{openMultiSelect === id ? ' open' : ''}}" data-filter-attr="${{escapeHtml(f.attr)}}">
                    <button type="button" class="multi-select-toggle" title="${{escapeHtml(summary)}}">
                        <span class="multi-select-summary">${{escapeHtml(summary)}}</span><span>▾</span>
                    </button>
                    <div class="multi-select-menu">
                        ${{f.values.length > 8 ? `<input type="text" class="multi-select-search" placeholder="Search..." value="${{escapeHtml(search)}}">` : ''}}
                        <button type="button" class="link-btn" data-action="clear">Clear (show all)</button>
                        <div class="multi-select-options">${{options}}</div>
                    </div>
                </div>
            </div>`;
        }}

        // Filter bar markup shared by the component tabs and the Power Balance view.
        // filterCfg entries carry their selectable values (see cascadeFilterValues).
        // opts: id (required), title, noun (default 'series'), extraHtml, note
        function renderFilterBar(stateKey, filterCfg, totalCount, shownCount, opts) {{
            const selected = activeFilters[stateKey] || {{}};
            let html = `<div class="filter-bar" id="${{opts.id}}">`;
            if (opts.title) {{
                html += `<div class="filter-title">${{escapeHtml(opts.title)}}</div>`;
            }}
            filterCfg.forEach(f => {{ html += renderMultiSelect(stateKey, f, selected[f.attr] || []); }});
            html += `<div class="control-group"><button type="button" class="reset-filters">Reset Filters</button></div>
                ${{opts.extraHtml || ''}}
                <div class="filter-count">Showing ${{shownCount}} of ${{totalCount}} ${{opts.noun || 'series'}}</div>`;
            if (opts.note) {{
                html += `<div class="filter-note">${{opts.note}}</div>`;
            }}
            return html + '</div>';
        }}

        function closeMultiSelects() {{
            openMultiSelect = null;
            document.querySelectorAll('.multi-select.open').forEach(m => m.classList.remove('open'));
        }}
        document.addEventListener('click', e => {{
            if (!e.target.closest('.multi-select')) closeMultiSelects();
        }});

        // onReset (optional) runs when Reset Filters is pressed, before re-rendering
        function bindFilterBar(root, stateKey, rerender, onReset) {{
            root.querySelectorAll('.multi-select').forEach(ms => {{
                const attr = ms.dataset.filterAttr;
                const id = stateKey + '|' + attr;
                ms.querySelector('.multi-select-toggle').addEventListener('click', () => {{
                    const willOpen = !ms.classList.contains('open');
                    closeMultiSelects();
                    if (willOpen) {{
                        ms.classList.add('open');
                        openMultiSelect = id;
                        const search = ms.querySelector('.multi-select-search');
                        if (search) search.focus();
                    }}
                }});
                ms.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', () => {{
                    activeFilters[stateKey] = activeFilters[stateKey] || {{}};
                    activeFilters[stateKey][attr] = [...ms.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
                    rerender();
                }}));
                ms.querySelector('[data-action=clear]').addEventListener('click', () => {{
                    if (activeFilters[stateKey]) delete activeFilters[stateKey][attr];
                    rerender();
                }});
                const search = ms.querySelector('.multi-select-search');
                if (search) search.addEventListener('input', () => {{
                    multiSelectSearch[id] = search.value;
                    const q = search.value.toLowerCase();
                    ms.querySelectorAll('.multi-select-option').forEach(o => {{
                        o.style.display = o.textContent.toLowerCase().includes(q) ? '' : 'none';
                    }});
                }});
            }});
            root.querySelector('.reset-filters').addEventListener('click', () => {{
                delete activeFilters[stateKey];
                closeMultiSelects();
                if (onReset) onReset();
                rerender();
            }});
        }}

        // Resolve a balance entry to {{ name: values }} (either referenced component data or inline series)
        function resolveBalanceSeries(entry) {{
            if (!entry) return null;
            if (entry.ref) {{
                const [comp, attr] = entry.ref;
                return networkData.components[comp].timeseries[attr].data;
            }}
            return entry.series;
        }}

        function sumSeries(names, series, length) {{
            const out = new Array(length).fill(0);
            names.forEach(name => {{
                const values = series[name];
                if (!values) return;
                for (let i = 0; i < length; i++) out[i] += values[i] || 0;
            }});
            return out;
        }}

        // Sum series grouped by keyFn(name); returns {{ groupKey: values }} sorted by key
        function groupSeries(names, series, keyFn, length) {{
            const groups = {{}};
            names.forEach(name => {{
                const key = keyFn(name);
                (groups[key] = groups[key] || []).push(name);
            }});
            const out = {{}};
            Object.keys(groups).sort().forEach(key => {{ out[key] = sumSeries(groups[key], series, length); }});
            return out;
        }}

        function optionButtons(option, choices, current, disabled) {{
            return choices.map(([value, label]) =>
                `<button type="button" class="toggle-btn${{value === current && !disabled ? ' active' : ''}}" data-option="${{option}}" data-value="${{value}}" ${{disabled ? 'disabled' : ''}}>${{label}}</button>`
            ).join('');
        }}

        // On/off button bound to a boolean in balanceState
        function flagButton(key, label) {{
            return `<div class="control-group"><button type="button" class="toggle-btn${{balanceState[key] ? ' active' : ''}}" data-flag="${{key}}">${{label}}</button></div>`;
        }}

        // Net power flowing into the given (non-hydro) nodes through links, from the nodes' perspective:
        // into the node is positive, out of the node is negative. Links touching a hydro bus are reported
        // separately as hydro storage (discharge +, charging -).
        // Returns per-line flows ('kind|bus' keys, split by bus if requested) and the unsplit totals.
        function computeImports(balance, length, nodes, split) {{
            const info = balance.links;
            const hydro = new Set(balance.hydro_buses);
            const linkStatic = networkData.components[info.component].static;
            const busAttrs = Object.keys(linkStatic).filter(a => /^bus\\d+$/.test(a));
            const isHydroLink = name => busAttrs.some(a => hydro.has(linkStatic[a][name]));

            const flows = {{}};
            const totals = {{ other: new Array(length).fill(0), hydro: new Array(length).fill(0) }};
            const connected = new Set();
            info.ports.forEach(port => {{
                const series = resolveBalanceSeries(port);
                port.names.forEach(name => {{
                    const bus = linkStatic[port.bus_attr][name];
                    const values = series[name];
                    if (!nodes.has(bus) || !values) return;
                    connected.add(name);
                    const kind = isHydroLink(name) ? 'hydro' : 'other';
                    const key = kind + '|' + (split ? bus : '');
                    const acc = flows[key] = flows[key] || new Array(length).fill(0);
                    const total = totals[kind];
                    // p_i is power withdrawn from bus_i by the link, so the injection into the bus is -p_i
                    for (let i = 0; i < length; i++) {{
                        const v = values[i] || 0;
                        acc[i] -= v;
                        total[i] -= v;
                    }}
                }});
            }});
            const totalLinks = info.ports.length ? info.ports[0].names.length : 0;
            return {{ flows, totals, connected: connected.size, totalLinks }};
        }}

        // Build the Power Balance skeleton; controls and plot are filled by refreshBalance()
        function displayLoadGeneration() {{
            const contentDiv = document.getElementById('contentDisplay');

            if (!networkData.balance) {{
                contentDiv.innerHTML = '<div class="error-panel"><strong>No load or generation data available</strong></div>';
                return;
            }}

            contentDiv.innerHTML = `
                <div class="info-panel" id="balanceInfo"></div>
                <div id="balanceControls"></div>
                <div class="plot-container"><div id="balancePlot" style="width:100%;height:600px;"></div></div>`;
            currentData = {{ type: 'load_generation' }};
            refreshBalance();
        }}

        function refreshBalance() {{
            const balance = networkData.balance;
            const state = balanceState;
            const scale = BALANCE_UNITS[state.unit];
            const length = balance.time_index.length;
            const hasImports = !!(balance.links && balance.links.ports.length);
            const available = {{
                load: !!balance.loads, generation: !!balance.generators,
                imports: hasImports, storage: !!balance.storage,
                mismatch: !!balance.loads && !!balance.generators
            }};
            const isOn = key => available[key] && state.visible[key];

            // --- Shared node picker: every plot is restricted to the selected nodes (All = every non-hydro bus)
            const hydro = new Set(balance.hydro_buses);
            const nodeOptions = balance.buses.filter(b => !hydro.has(b)).sort();
            const pickedNodes = (activeFilters[BALANCE_NODE_FILTERS] || {{}}).bus || [];
            const nodes = new Set(pickedNodes.length ? pickedNodes : nodeOptions);

            const attrOf = (entry, attr, fallback) => {{
                const col = entry && networkData.components[entry.component].static[attr];
                return name => {{
                    const v = col ? col[name] : undefined;
                    return v === undefined || v === '' ? fallback : v;
                }};
            }};
            const atNodes = entry => {{
                const bus = attrOf(entry, 'bus', null);
                return entry.names.filter(n => nodes.has(bus(n)));
            }};

            // --- Loads at the selected nodes
            const loadSeries = resolveBalanceSeries(balance.loads);
            const loadNames = balance.loads ? atNodes(balance.loads) : [];
            const loadBus = attrOf(balance.loads, 'bus', '(no bus)');

            // --- Generators at the selected nodes, then the carrier / type filters of the Generators tab
            const genSeries = resolveBalanceSeries(balance.generators);
            const genNodeNames = balance.generators ? atNodes(balance.generators) : [];
            const genCfg = balance.generators
                ? (getFilterConfig(balance.generators.component) || []).filter(f => f.attr !== 'bus') : [];
            let genNames = genNodeNames;
            let genFilterValues = [];
            if (genCfg.length) {{
                // Options only cover generators at the selected nodes, cascading Carrier -> Type
                genFilterValues = cascadeFilterValues(BALANCE_GEN_FILTERS, balance.generators.component, genCfg, genNodeNames);
                const byName = Object.fromEntries(genNodeNames.map(n => [n, true]));
                genNames = Object.keys(applyAttributeFilters(BALANCE_GEN_FILTERS, balance.generators.component, genCfg, byName));
            }}
            const genBus = attrOf(balance.generators, 'bus', '(no bus)');
            const genCarrier = attrOf(balance.generators, 'carrier', '(no carrier)');

            // --- Storage units and stores at the selected nodes
            let storageTotal = null;
            if (balance.storage) {{
                storageTotal = new Array(length).fill(0);
                balance.storage.forEach(entry => {{
                    const s = sumSeries(atNodes(entry), resolveBalanceSeries(entry), length);
                    for (let i = 0; i < length; i++) storageTotal[i] += s[i];
                }});
            }}

            const imports = hasImports ? computeImports(balance, length, nodes, state.importSplit) : null;

            // Aggregate on the full time axis (only for plots that are switched on), then restrict to the selected period
            const raw = {{}}, meta = {{}};
            const add = (key, values, m) => {{ raw[key] = values; meta[key] = m; }};
            if (isOn('generation') && state.showCarriers) {{
                Object.entries(groupSeries(genNames, genSeries, genCarrier, length))
                    .forEach(([carrier, v]) => add('carrier|' + carrier, v, {{ group: 'carrier', label: carrier }}));
            }}
            if (isOn('load')) {{
                if (state.loadSplit) {{
                    Object.entries(groupSeries(loadNames, loadSeries, loadBus, length))
                        .forEach(([bus, v]) => add('load|' + bus, v, {{ group: 'load', bus }}));
                }} else {{
                    add('load|', sumSeries(loadNames, loadSeries, length), {{ group: 'load' }});
                }}
            }}
            if (isOn('generation')) {{
                if (state.genSplit) {{
                    Object.entries(groupSeries(genNames, genSeries, genBus, length))
                        .forEach(([bus, v]) => add('generation|' + bus, v, {{ group: 'generation', bus }}));
                }} else {{
                    add('generation|', sumSeries(genNames, genSeries, length), {{ group: 'generation' }});
                }}
            }}
            if (isOn('imports')) {{
                Object.keys(imports.flows).sort().forEach(key => {{
                    const [kind, ...bus] = key.split('|');
                    add('imports|' + key, imports.flows[key], {{ group: 'imports', kind, bus: bus.join('|') || undefined }});
                }});
            }}
            if (isOn('storage')) add('storage|', storageTotal, {{ group: 'storage' }});
            if (isOn('mismatch')) {{
                // Uses every generator at the selected nodes (carrier / type filters would distort the check)
                const load = sumSeries(loadNames, loadSeries, length);
                const gen = sumSeries(genNodeNames, genSeries, length);
                const mismatch = load.map((l, i) => l - gen[i]
                    - (imports ? imports.totals.other[i] + imports.totals.hydro[i] : 0)
                    - (storageTotal ? storageTotal[i] : 0));
                add('mismatch|', mismatch, {{ group: 'mismatch' }});
            }}
            const {{ timeIndex, timeStrings, seriesData, periodLabel }} = applyPeriodFilter(balance.time_index, raw);

            // Consistent colour per bus across split load / generation / import lines
            const allBuses = [...new Set(Object.values(meta).map(m => m.bus).filter(b => b !== undefined))].sort();
            const busColor = bus => BUS_COLORS[allBuses.indexOf(bus) % BUS_COLORS.length];

            const stacked = state.carrierMode === 'stacked';
            const filled = state.stackStyle === 'filled';
            // Object key order follows insertion, so carrier areas are drawn first and lines stay on top
            const traces = Object.entries(seriesData).map(([key, values]) => {{
                const m = meta[key];
                const t = {{ x: timeIndex, y: values.map(v => v * scale), type: 'scatter', mode: 'lines' }};
                if (m.bus !== undefined) t.legendgroup = m.bus;
                if (m.group === 'load') {{
                    Object.assign(t, m.bus !== undefined
                        ? {{ name: `Load – ${{m.bus}}`, line: {{ width: 2, dash: 'dot', color: busColor(m.bus) }} }}
                        : {{ name: balance.load_source === 'p' ? 'Load' : 'Load (p_set)', line: {{ width: 3, color: '#c0392b' }} }});
                }} else if (m.group === 'generation') {{
                    Object.assign(t, m.bus !== undefined
                        ? {{ name: `Generation – ${{m.bus}}`, line: {{ width: 2, color: busColor(m.bus) }} }}
                        : {{ name: 'Generation', line: {{ width: 3, color: '#27ae60' }} }});
                }} else if (m.group === 'carrier') {{
                    const color = carrierColor(m.label);
                    t.name = m.label;
                    t.line = {{ width: stacked && filled ? 0.5 : 2, color }};
                    if (stacked) {{
                        t.stackgroup = 'carriers';
                        if (filled) {{
                            t.fillcolor = color;
                        }} else {{
                            t.fill = 'none';
                        }}
                    }}
                }} else if (m.group === 'imports') {{
                    const base = m.kind === 'hydro' ? 'Hydro storage (net)' : 'Imports (net)';
                    Object.assign(t, m.bus !== undefined
                        ? {{ name: `${{base}} – ${{m.bus}}`, line: {{ width: 2, dash: m.kind === 'hydro' ? 'longdash' : 'dashdot', color: busColor(m.bus) }} }}
                        : {{ name: base, line: m.kind === 'hydro'
                            ? {{ width: 2.5, dash: 'dash', color: HYDRO_COLOR }}
                            : {{ width: 2.5, color: '#2980b9' }} }});
                }} else if (m.group === 'storage') {{
                    Object.assign(t, {{ name: 'Storage (net)', line: {{ width: 2, dash: 'dash', color: '#8e44ad' }} }});
                }} else if (m.group === 'mismatch') {{
                    Object.assign(t, {{ name: 'Mismatch', line: {{ width: 2, dash: 'dot', color: '#2c3e50' }} }});
                }}
                return t;
            }});
            balanceExport = {{ timeStrings, unit: state.unit, periodLabel, columns: traces.map(t => ({{ name: t.name, values: t.y }})) }};

            // --- Info panel
            const notes = [];
            if (balance.load_source === 'p_set') notes.push('Load shows the p_set input (network has no optimised load results).');
            if (!balance.generators) notes.push('Generation dispatch is unavailable — optimise the network to see generation.');
            document.getElementById('balanceInfo').innerHTML = `
                <h3>Power Balance${{periodLabel}}</h3>
                <p>1. Pick the node(s) to analyse &nbsp;·&nbsp; 2. Switch plots on or off (switching a plot on opens its options) &nbsp;·&nbsp;
                   3. Hover over a button for an explanation.</p>
                ${{notes.map(n => `<p><em>${{n}}</em></p>`).join('')}}`;

            // --- Controls
            const nodeBar = renderFilterBar(BALANCE_NODE_FILTERS,
                [{{ attr: 'bus', label: 'Node(s)', values: nodeOptions }}], nodeOptions.length, nodes.size,
                {{ id: 'balanceNodeFilters', title: 'Nodes', noun: 'nodes',
                   note: 'Applies to every plot below. Hydro buses (' + balance.hydro_suffixes.join(', ') + ') are not listed: ' +
                         'their contribution appears as <em>Hydro storage (net)</em> under Imports.' }});

            // Each plot button opens its own options panel while it is switched on
            const panels = {{}};
            if (balance.loads) {{
                panels.load = `<div class="filter-bar" id="balanceLoadOptions">
                    <div class="filter-title">Load options</div>
                    ${{flagButton('loadSplit', 'Split by Bus')}}
                    <div class="filter-count">Showing ${{loadNames.length}} of ${{balance.loads.names.length}} loads</div>
                </div>`;
            }}
            if (balance.generators) {{
                const carriersOff = !state.showCarriers;
                const genOptions = {{ id: 'balanceGenFilters', title: 'Generation filters', noun: 'generators',
                    extraHtml: flagButton('genSplit', 'Split by Bus') }};
                panels.generation = (genCfg.length
                    ? renderFilterBar(BALANCE_GEN_FILTERS, genFilterValues,
                        balance.generators.names.length, genNames.length, genOptions)
                    : `<div class="filter-bar" id="balanceGenFilters"><div class="filter-title">Generation filters</div>${{genOptions.extraHtml}}</div>`)
                    + `<div class="filter-bar" id="balanceGenDisplay">
                        <div class="filter-title">Generation Display Options</div>
                        ${{flagButton('showCarriers', 'Show Carrier Breakdown')}}
                        <div class="control-group">
                            <label class="control-label">Carrier Breakdown</label>
                            <div class="button-group">${{optionButtons('carrierMode', [['lines', 'Lines'], ['stacked', 'Stacked']], state.carrierMode, carriersOff)}}</div>
                        </div>
                        <div class="control-group">
                            <label class="control-label">Stacked Style</label>
                            <div class="button-group">${{optionButtons('stackStyle', [['filled', 'Filled'], ['line', 'Line Only']], state.stackStyle, carriersOff || !stacked)}}</div>
                        </div>
                    </div>`;
            }}
            if (hasImports) {{
                panels.imports = `<div class="filter-bar" id="balanceImportOptions">
                    <div class="filter-title">Import options</div>
                    ${{flagButton('importSplit', 'Split by Bus')}}
                    <div class="filter-count">Showing ${{imports.connected}} of ${{imports.totalLinks}} links connected</div>
                    <div class="filter-note">Power flowing <strong>into</strong> the selected node(s) is positive; power flowing <strong>out</strong> is negative.
                        Links to hydro buses are shown separately as <em>Hydro storage (net)</em>: discharge is positive, charging is negative.
                        Flows between two selected nodes cancel out.</div>
                </div>`;
            }}

            const visibilityButtons = BALANCE_GROUPS.map(g => {{
                const active = isOn(g.key);
                const caret = panels[g.key] ? `<span class="caret">${{active ? '▾' : '▸'}}</span>` : '';
                return `<button type="button" class="toggle-btn${{active ? ' active' : ''}}" data-group="${{g.key}}" title="${{escapeHtml(g.hint)}}" ${{available[g.key] ? '' : 'disabled'}}>
                    <span class="swatch" style="background:${{g.color}}"></span>${{g.label}}${{caret}}</button>`;
            }}).join('');

            let controls = nodeBar + `<div class="toggle-bar">${{visibilityButtons}}</div>`;
            BALANCE_GROUPS.forEach(g => {{
                if (panels[g.key] && isOn(g.key)) {{
                    controls += `<div class="group-panel" style="border-left-color:${{g.color}}">${{panels[g.key]}}</div>`;
                }}
            }});
            // Download + unit selector: always available, right-aligned directly above the plot
            controls += `<div class="unit-bar">
                <button type="button" class="toggle-btn" id="balanceDownload" title="Download the plotted series (current nodes, filters, period and unit) as CSV">⬇ Download CSV</button>
                <label class="control-label">Unit</label>
                <div class="button-group">${{optionButtons('unit', Object.keys(BALANCE_UNITS).map(u => [u, u]), state.unit, false)}}</div>
            </div>`;

            const controlsDiv = document.getElementById('balanceControls');
            controlsDiv.innerHTML = controls;

            controlsDiv.querySelectorAll('[data-group]').forEach(btn => btn.addEventListener('click', function() {{
                state.visible[this.dataset.group] = !state.visible[this.dataset.group];
                refreshBalance();
            }}));
            controlsDiv.querySelectorAll('[data-flag]').forEach(btn => btn.addEventListener('click', function() {{
                state[this.dataset.flag] = !state[this.dataset.flag];
                refreshBalance();
            }}));
            controlsDiv.querySelectorAll('[data-option]').forEach(btn => btn.addEventListener('click', function() {{
                state[this.dataset.option] = this.dataset.value;
                refreshBalance();
            }}));
            document.getElementById('balanceDownload').addEventListener('click', downloadBalanceCsv);
            // Resetting the nodes switches off every Split by Bus; resetting generator filters switches off the generation split
            bindFilterBar(document.getElementById('balanceNodeFilters'), BALANCE_NODE_FILTERS, refreshBalance, () => {{
                state.loadSplit = state.genSplit = state.importSplit = false;
            }});
            const genBar = document.getElementById('balanceGenFilters');
            if (genBar && genBar.querySelector('.reset-filters')) {{
                bindFilterBar(genBar, BALANCE_GEN_FILTERS, refreshBalance, () => {{ state.genSplit = false; }});
            }}

            // --- Plot (react keeps the x-axis zoom between updates; the y-axis resets when the unit changes)
            Plotly.react('balancePlot', traces, {{
                title: `Power Balance${{periodLabel}}`,
                xaxis: {{ title: 'Time', type: 'date', uirevision: 'balance' }},
                yaxis: {{ title: state.unit, uirevision: state.unit, zeroline: true, zerolinecolor: '#7f8c8d' }},
                hovermode: 'x unified',
                legend: {{ orientation: 'h', x: 0.5, xanchor: 'center', y: -0.2 }},
                margin: {{ l: 80, r: 80, t: 80, b: 120 }},
                uirevision: 'balance'
            }}, {{ responsive: true, displayModeBar: true, displaylogo: false }});
        }}

        // Save the series currently shown in the Power Balance plot as a CSV file
        function downloadBalanceCsv() {{
            if (!balanceExport || balanceExport.columns.length === 0) {{
                alert('Nothing to download: switch at least one plot on.');
                return;
            }}
            const csvCell = v => {{
                const s = String(v);
                return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }};
            const {{ timeStrings, unit, columns }} = balanceExport;
            const header = ['snapshot', ...columns.map(c => `${{c.name}} [${{unit}}]`)];
            const lines = [header.map(csvCell).join(',')];
            timeStrings.forEach((t, i) => {{
                lines.push([t, ...columns.map(c => c.values[i])].map(csvCell).join(','));
            }});
            const period = balanceExport.periodLabel.replace(/[^0-9A-Za-z]+/g, '_').replace(/^_|_$/g, '');
            const blob = new Blob([lines.join('\\n')], {{ type: 'text/csv;charset=utf-8' }});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `power_balance${{period ? '_' + period : ''}}_${{unit}}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(a.href);
        }}

        function clearDisplay() {{
            document.getElementById('contentDisplay').innerHTML =
                '<div class="info-panel"><h3>Display Cleared</h3><p>Select component and data type to load new data.</p></div>';
            currentData = null;
        }}

        function showLoading(show) {{
            document.getElementById('loading').style.display = show ? 'block' : 'none';
        }}

        function showError(message) {{
            document.getElementById('contentDisplay').innerHTML =
                `<div class="error-panel"><strong>Error:</strong> ${{message}}</div>`;
        }}
    </script>
</body>
</html>'''

    if file_path is not None:
        os.makedirs(file_path, exist_ok=True)

    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"Network analyzer generated: {output_file}")
    print(f"Components found: {list(component_info['components'].keys())}")

    return output_file


def _decode_binary_arrays(obj):
    """
    Recursively decode Plotly 6.x binary-encoded arrays ({dtype, bdata}) back
    to plain Python lists so they serialise correctly in all Plotly.js versions.
    """
    import base64
    import numpy as np

    _dtype_map = {
        "f8": "<f8", "f4": "<f4",
        "i1": "<i1", "u1": "<u1",
        "i2": "<i2", "u2": "<u2",
        "i4": "<i4", "u4": "<u4",
    }
    if isinstance(obj, dict):
        if "bdata" in obj and "dtype" in obj:
            raw = base64.b64decode(obj["bdata"])
            dt = _dtype_map.get(obj["dtype"], "<f8")
            return np.frombuffer(raw, dtype=dt).tolist()
        return {k: _decode_binary_arrays(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_decode_binary_arrays(v) for v in obj]
    return obj


def _load_custom_plots_from_file(file_path, network):
    """
    Dynamically import a custom plots Python file and call its ``get_plots(network)`` function.

    The file must define a function ``get_plots(network)`` that returns a list of
    Plotly figure objects.
    """
    file_path = os.path.abspath(file_path)
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"Custom plots file not found: {file_path}")

    module_name = os.path.splitext(os.path.basename(file_path))[0]
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    if not hasattr(module, 'get_plots'):
        raise AttributeError(
            f"Custom plots file '{file_path}' must define a function: get_plots(network)"
        )

    return module.get_plots(network)


def _extract_component_info(network, currency='$', custom_plots=None):
    """
    Extract component information from a PyPSA network using the new components API.

    All components are discovered dynamically from ``network.components`` — no
    hard-coded component lists. Timeseries attributes are read directly from
    each component's ``.dynamic`` mapping.
    """

    component_info = {
        'summary': {},
        'components': {},
        'component_classes': {},
        'balance': None,
        'custom_plots': {}
    }

    # --- Snapshot / multi-index detection ----------------------------------
    is_multi_index = isinstance(network.snapshots, pd.MultiIndex)
    if is_multi_index:
        ts_level = network.snapshots.get_level_values(1)
        try:
            snapshot_time_index = ts_level.strftime('%Y-%m-%d %H:%M:%S').tolist()
        except AttributeError:
            snapshot_time_index = [str(t) for t in ts_level]
        period_values = network.snapshots.get_level_values(0)
        snapshot_period_index = [str(p) for p in period_values]
        periods = [str(p) for p in period_values.unique()]
        snapshot_time_range = {
            'start': str(ts_level[0]),
            'end': str(ts_level[-1]),
            'periods': len(network.snapshots)
        }
    else:
        snapshot_time_index = network.snapshots.strftime('%Y-%m-%d %H:%M:%S').tolist()
        snapshot_period_index = None
        periods = None
        snapshot_time_range = {
            'start': str(network.snapshots[0]),
            'end': str(network.snapshots[-1]),
            'periods': len(network.snapshots)
        }

    # --- Dynamic component discovery via new PyPSA API ---------------------
    for comp_name, comp in network.components.items():
        static_df = comp.static

        if static_df.empty:
            continue

        component_info['summary'][comp_name] = len(static_df)
        # Map class name (e.g. 'Generator') to the key used in 'components'
        component_info['component_classes'][getattr(comp, 'name', comp_name)] = comp_name
        component_info['components'][comp_name] = {
            'static': {},
            'timeseries': {}
        }

        # Static columns
        for col in static_df.columns:
            data_dict = static_df[col].to_dict()
            component_info['components'][comp_name]['static'][col] = {
                str(k): str(v) for k, v in data_dict.items()
            }

        # Timeseries: iterate over comp.dynamic (dict of DataFrames)
        for attr_name, ts_df in comp.dynamic.items():
            if ts_df.empty:
                continue

            unit = _get_unit_for_attribute(attr_name, currency=currency)
            ts_data = {str(col): ts_df[col].tolist() for col in ts_df.columns}

            component_info['components'][comp_name]['timeseries'][attr_name] = {
                'data': ts_data,
                'time_index': snapshot_time_index,
                'time_range': snapshot_time_range,
                'unit': unit
            }

    # --- Power balance and carrier colours ------------------------------------
    component_info['balance'] = _extract_balance(network, snapshot_time_index)
    component_info['carrier_colors'] = _extract_carrier_colors(network)

    component_info['summary']['snapshots'] = len(network.snapshots)
    component_info['summary']['is_multi_index'] = is_multi_index
    if is_multi_index:
        component_info['summary']['periods'] = periods
        component_info['summary']['period_index'] = snapshot_period_index

    # --- Network metadata --------------------------------------------------
    network_info = {
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
            network_info[f'Metadata - {key}'] = str(value)
    component_info['summary']['network_info'] = network_info

    # --- Global constraints ------------------------------------------------
    gc = network.components.get('global_constraints')
    if gc is not None:
        gc_df = gc.static
        if not gc_df.empty:
            gc_list = []
            for idx, row in gc_df.iterrows():
                entry = {'name': idx}
                for col in gc_df.columns:
                    entry[col] = (
                        f"{row[col]:.2f}" if col == 'mu' and row[col] is not None
                        else str(row[col]) if row[col] is not None
                        else 'N/A'
                    )
                gc_list.append(entry)
            component_info['summary']['global_constraints'] = gc_list

    # --- Custom plots ------------------------------------------------------
    if custom_plots is not None:
        if isinstance(custom_plots, str):
            plots = _load_custom_plots_from_file(custom_plots, network)
        else:
            plots = custom_plots

        import plotly.io as pio
        import json as _json

        plot_names = []
        for i, fig in enumerate(plots):
            title_text = (
                fig.layout.title.text
                if fig.layout.title and fig.layout.title.text
                else f"Plot {i + 1}"
            )
            plot_names.append(title_text)
            fig_dict = _decode_binary_arrays(_json.loads(pio.to_json(fig)))
            component_info['custom_plots'][title_text] = {
                'data': fig_dict['data'],
                'layout': fig_dict['layout']
            }

        component_info['summary']['custom_plots'] = plot_names

    return component_info


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


def _extract_balance(network, time_index):
    """
    Build the per-component load and generation timeseries used by the
    "Power Balance" view. Aggregation (totals, per bus, per carrier) is
    done in the browser so it can follow the user's filters. Returns None if
    the network has no loads and no generators.
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
        suffixes = tuple(s.lower() for s in HYDRO_BUS_SUFFIXES)
        balance['buses'] = [str(b) for b in buses.static.index]
        balance['hydro_buses'] = [b for b in balance['buses'] if b.strip().lower().endswith(suffixes)]

    # Link flows at every port (bus0, bus1, bus2, ...) for the Imports view
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


def _extract_carrier_colors(network):
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


def _get_unit_for_attribute(attr, currency='$'):
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
