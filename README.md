# PyPSA Network Viewer

Interactive HTML viewer and Excel template generator for PyPSA networks (requires PyPSA >= 1.0).

`html_network()` writes a single, self-contained HTML file (only Plotly and the map tiles are loaded
from the internet) that can be opened in any browser and shared as is.

## Features

The viewer page has five tabs:

| Tab | What it shows |
|---|---|
| **Network Summary** | Component counts, network name, PyPSA version, objective, metadata |
| **Power Balance** | Load, generation (by carrier and hydro type), imports / exports (by node), storage and a mismatch check, for any selection of nodes, with time range, unit and CSV download |
| **Network Components** | Static tables and timeseries plots of every component (discovered dynamically), global constraints; filters (carrier, type, node, hydro buses), unit conversion, CSV download |
| **Custom Plots** | Your own Plotly figures, with automatic filters and unit conversion when they show network components |
| **Network Explore** | The interactive map of `n.explore()` (needs bus coordinates) |

**💾 Save this view** (top right) downloads a copy of the page that opens on the current tab, filters
and settings — handy to share a specific view. The address bar also remembers the view, as a bookmark
of the file on your own computer.

Also included: **`generate_template()`**, which creates a pre-configured Excel workbook to define a new network.

## Requirements

- Python 3.10+
- PyPSA >= 1.0
- Plotly 5.0+ (custom plots), pydeck (Network Explore map)
- openpyxl, only for the Excel template generator (`pip install "pypsa-network-viewer[excel]"`)

## Installation

```bash
pip install git+https://github.com/MaksLatz/pypsa_network_viewer.git
```

## Quick Start

### HTML Viewer

```python
import pypsa
from pypsa_network_viewer import html_network

network = pypsa.examples.ac_dc_meshed()
network.optimize()

html_network(network, file_name='my_network.html')
```

Power Balance and the dispatch timeseries need an optimised network; the other tabs also work on an
un-optimised one.

### Complete example

```python
import plotly.graph_objects as go

p = network.components['generators'].dynamic['p']
fig = go.Figure([go.Scatter(x=p.index, y=p[col], mode='lines', name=col) for col in p.columns])
fig.update_layout(title='Generator Dispatch', yaxis_title='MW')

html_network(
    network,
    file_path='output',                 # created if needed
    file_name='complete_analysis.html',
    title='My Network Analysis',
    currency='€',
    custom_plots=[fig],
)
# -> open output/complete_analysis.html in a browser
```

### Custom Plots from a file

Create a `my_plots.py` file with a `get_plots(network)` function (copy
[`examples/custom_plots_template.py`](examples/custom_plots_template.py) as a starting point):

```python
# my_plots.py
import plotly.graph_objects as go

def get_plots(network):
    fig = go.Figure()
    # ... build plots using network data ...
    fig.update_layout(title='My Plot')
    return [fig]
```

Then pass the file path:

```python
html_network(network, file_name='analysis.html', custom_plots='my_plots.py')
```

The template includes three example plots: generator dispatch, installed capacity and system costs.

### Excel Template Generator

```python
from pypsa_network_viewer import generate_template

# 1 year, hourly resolution
generate_template(
    output_name='network_template.xlsx',
    start_year=2025,
    start_month=1,
    years_duration=1,
    resolution_str='H',
)

# 3 months, 30-minute resolution, 2 link outputs
generate_template(
    output_name='network_template_3m.xlsx',
    start_year=2025,
    start_month=6,
    months_duration=3,
    resolution_str='30m',
    link_outputs=2,
)
```

## `html_network` Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `network` | `pypsa.Network` | required | Network to visualize |
| `file_path` | `str` | `None` | Output directory (current directory if `None`) |
| `file_name` | `str` | `'network_analyzer.html'` | Output filename |
| `title` | `str` | `'PyPSA Network Analyzer'` | Page title |
| `currency` | `str` | `'$'` | Currency symbol for cost units |
| `custom_plots` | `str` or `list` | `None` | Path to a `.py` file with `get_plots(network)`, or a list of Plotly figures |

`html_viewer` is the former name of `html_network` and still works.

## `generate_template` Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `output_name` | `str` | required | Output `.xlsx` file path |
| `start_year` | `int` | `2024` | Start year (2024–2029) |
| `start_month` | `int` | `1` | Start month (1–12) |
| `years_duration` | `int\|None` | `1` | Duration in years (1–5) |
| `months_duration` | `int\|None` | `None` | Duration in months (1–12) |
| `days_duration` | `int\|None` | `None` | Duration in days (7–31) |
| `resolution_str` | `str` | `'H'` | Timestep: `'H'`, `'2H'`, `'4H'`, `'6H'`, `'8H'`, `'0.5H'`, `'15m'`, `'30m'` |
| `drop_leap_day` | `bool` | `True` | Skip Feb 29 timestamps |
| `link_outputs` | `int` | `1` | Number of link output buses |
| `process_outputs` | `int` | `2` | Number of process output buses |

Exactly one of `years_duration`, `months_duration`, or `days_duration` must be set.

## Tips

- **Hydro**: buses whose name ends with *Open loop pumping*, *Pondage*, *Reservoir* or *Closed loop
  pumping* are hydro storage buses (`HYDRO_BUS_SUFFIXES` in `extract/balance.py`). In Power Balance their
  links count as *Hydro Generation* / *Hydro Pumping*; in Network Components they can be shown or hidden.
- **Network Explore** needs bus coordinates (`x` = longitude, `y` = latitude).
- **Custom Plots**: the plot title is its name in the selector — give each figure a meaningful title.
  Units are read from the y-axis title (MW, MWh or currency/MWh).
- **Large networks**: the HTML file grows with the number of components and snapshots. In Power Balance,
  narrow the Time Range for carrier breakdowns, and pick nodes before using Split by Bus.

## Troubleshooting

- **Custom plots not appearing**: a figure that cannot be converted, or a file without `get_plots`, is
  skipped with a warning in Python — check the console output of `html_network`.
- **Empty Power Balance**: optimise the network first (`network.optimize()`); without results only the
  load input (`p_set`) is shown.
- **Network Explore shows an error**: install `pydeck`, and check the bus coordinates.

## Repository Layout

```
pypsa_network_viewer/        the package
├── viewer.py                html_network(), the entry point
├── extract/                 network -> data shown on the page (one module per part)
├── render.py                assembles the single HTML file from templates/ and the data
├── templates/               page.html, viewer.css and the JavaScript modules (js/)
└── excel_template_generator.py   generate_template()
examples/                    example notebooks and the custom plots template
archive/                     earlier development notebook, kept for reference
```

## Example Notebooks

- [examples/example.ipynb](examples/example.ipynb) — runnable examples of the viewer
- [examples/excel_template_generator.ipynb](examples/excel_template_generator.ipynb) — the Excel template generator

## Contributing

Issues and pull requests are welcome.

## License

MIT License

## Author

Priyesh Gosai, Max Latz and Claude Code
