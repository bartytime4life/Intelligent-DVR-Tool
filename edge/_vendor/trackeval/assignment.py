"""TrackEval assignment adapter: reuse the application's exact Hungarian solver.

All finite pairs are feasible here. Unlike tracker association, this adapter does
not gate costs or remove pairs. Tie choices are deterministic input-order choices.
"""
import numpy as np

from ...tracking import assign


def linear_sum_assignment(cost):
    cost = np.asarray(cost, dtype=np.float64)
    if cost.ndim != 2 or not np.isfinite(cost).all():
        raise ValueError('Require a finite two-dimensional assignment matrix')
    if not cost.size:
        return np.array([], dtype=int), np.array([], dtype=int)
    matches, _, _ = assign(cost, float(cost.max()))
    matches.sort()
    return (np.array([r for r, _ in matches], dtype=int),
            np.array([c for _, c in matches], dtype=int))
