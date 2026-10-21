"""
Compact storage of timeseries in the viewer page.

Writing every value as JSON text costs 15-23 bytes per value; here all series of one attribute are
stored as one block of float32 values (4 bytes each, ~7 significant digits), gzip-compressed and
base64-encoded: about 6x smaller than text, and smaller than the network's .nc file. The page only
decompresses a block when a graph or tab first reads it (templates/js/core.js, decodeSeries).
"""

import base64
import gzip

import numpy as np

ENCODING = 'float32-gzip-base64'


def encode_frame(df):
    """
    DataFrame (snapshots x series) -> {'encoding', 'columns', 'length', 'blob'}: the series are stored one
    after the other (little-endian float32), NaN kept. Returns None if the values are not numeric.
    """
    try:
        values = df.to_numpy(dtype='float64', na_value=np.nan)
    except (TypeError, ValueError):
        return None
    block = np.ascontiguousarray(values.T, dtype='<f4').tobytes()
    return {
        'encoding': ENCODING,
        'columns': [str(c) for c in df.columns],
        'length': int(len(df.index)),
        # mtime=0: the same network always gives the same page
        'blob': base64.b64encode(gzip.compress(block, compresslevel=6, mtime=0)).decode('ascii'),
    }


JSON_ENCODING = 'json-gzip-base64'


def encode_json(obj):
    """Any JSON value -> {'encoding', 'blob'}: gzip-compressed JSON text in base64 (decodeJson in core.js)."""
    import json
    text = json.dumps(obj, separators=(',', ':'), allow_nan=False)
    return {'encoding': JSON_ENCODING,
            'blob': base64.b64encode(gzip.compress(text.encode('utf-8'), compresslevel=6, mtime=0)).decode('ascii')}
