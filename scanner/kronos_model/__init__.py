"""
Kronos model package — vendored from https://github.com/shiyu-coder/Kronos
(model/ directory). Import path fixed so it works when dropped into the
TradeSim scanner as kronos_model/.

Public API:
    KronosTokenizer  — BSQuantizer tokenizer for OHLCV data
    Kronos           — the autoregressive Transformer
    KronosPredictor  — high-level wrapper: DataFrame in → forecast DataFrame out
"""
from .kronos import KronosTokenizer, Kronos, KronosPredictor

model_dict = {
    'kronos_tokenizer': KronosTokenizer,
    'kronos': Kronos,
    'kronos_predictor': KronosPredictor
}


def get_model_class(model_name):
    if model_name in model_dict:
        return model_dict[model_name]
    else:
        print(f"Model {model_name} not found in model_dict")
        raise NotImplementedError


__all__ = ['KronosTokenizer', 'Kronos', 'KronosPredictor', 'get_model_class', 'model_dict']
