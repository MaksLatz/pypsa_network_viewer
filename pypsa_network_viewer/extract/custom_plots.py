"""Custom Plots data: user-supplied Plotly figures converted to plain JSON."""

import base64
import importlib.util
import json
import os
import re
import sys
import warnings

import numpy as np


def _decode_binary_arrays(obj):
    """
    Recursively decode Plotly 6.x binary-encoded arrays ({dtype, bdata}) back
    to plain Python lists so they serialise correctly in all Plotly.js versions.
    """
    _dtype_map = {
        "f8": "<f8", "f4": "<f4",
        "i1": "<i1", "u1": "<u1",
        "i2": "<i2", "u2": "<u2",
        "i4": "<i4", "u4": "<u4",
        "i8": "<i8", "u8": "<u8",
    }
    if isinstance(obj, dict):
        if "bdata" in obj and "dtype" in obj:
            raw = base64.b64decode(obj["bdata"])
            dt = _dtype_map.get(obj["dtype"], "<f8")
            arr = np.frombuffer(raw, dtype=dt)
            # 2-D data (e.g. heatmap z) carries its shape as "rows, cols"
            shape = obj.get("shape")
            if shape:
                if isinstance(shape, str):
                    shape = [int(s) for s in shape.split(',') if s.strip()]
                arr = arr.reshape(tuple(shape))
            return arr.tolist()
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


def extract_custom_plots(custom_plots, network):
    """
    Convert the custom plots to plain Plotly JSON, keyed by a unique display name.

    Custom plots change often, so a single bad entry must not stop the export: a file
    that cannot be loaded, or a figure that cannot be converted, is skipped with a
    warning. Accepts a file path, a single figure, or a list of figures / figure dicts.
    Duplicate titles get a numbered suffix instead of overwriting each other.

    Returns (plots_by_name, ordered_names).
    """
    import plotly.graph_objects as go
    import plotly.io as pio

    if isinstance(custom_plots, (str, os.PathLike)):
        try:
            plots = _load_custom_plots_from_file(custom_plots, network)
        except Exception as e:
            warnings.warn(f"Custom plots skipped, '{custom_plots}' could not be loaded: {type(e).__name__}: {e}")
            return {}, []
    else:
        plots = custom_plots
    if plots is None:
        plots = []
    elif isinstance(plots, (go.Figure, dict)):
        plots = [plots]

    by_name, names = {}, []
    for i, fig in enumerate(plots):
        if fig is None:
            continue
        try:
            if not isinstance(fig, go.Figure):
                fig = go.Figure(fig)
            fig_dict = _decode_binary_arrays(json.loads(pio.to_json(fig)))
        except Exception as e:
            reason = next((line.strip() for line in str(e).splitlines() if line.strip()), '')
            warnings.warn(f"Custom plot {i + 1} skipped, it is not a valid Plotly figure "
                          f"({type(e).__name__}: {reason[:200]})")
            continue

        title = fig.layout.title.text if fig.layout.title and fig.layout.title.text else ''
        # The name labels the plot selector: drop any HTML markup used for styling the title
        name = re.sub(r'<[^>]*>', '', str(title)).strip() or f"Plot {i + 1}"
        base, n = name, 2
        while name in by_name:
            name = f"{base} ({n})"
            n += 1
        by_name[name] = {'data': fig_dict.get('data') or [], 'layout': fig_dict.get('layout') or {}}
        names.append(name)
    return by_name, names
