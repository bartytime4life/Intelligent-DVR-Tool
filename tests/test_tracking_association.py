"""Exact sparse association objectives, independent of camera/model accuracy."""
import itertools
import random
import unittest

import numpy as np

from edge.tracking import assign, assign_gated


class ComponentAssignmentTest(unittest.TestCase):
    def compare(self, cost, limit=.8):
        cost = np.asarray(cost, dtype=float)
        pairs, free_rows, free_cols = assign_gated(cost, limit)
        expected, _, _ = assign(cost, limit)
        self.assertEqual(len(pairs), len(expected))
        self.assertAlmostEqual(sum(cost[r, c] for r, c in pairs),
                               sum(cost[r, c] for r, c in expected), places=10)
        self.assertEqual(len({r for r, _ in pairs}), len(pairs))
        self.assertEqual(len({c for _, c in pairs}), len(pairs))
        self.assertTrue(all(cost[r, c] <= limit for r, c in pairs))
        self.assertEqual(free_rows, sorted(set(range(cost.shape[0])) - {r for r, _ in pairs}))
        self.assertEqual(free_cols, sorted(set(range(cost.shape[1])) - {c for _, c in pairs}))
        self.assertEqual(assign_gated(cost, limit), (pairs, free_rows, free_cols))

    def test_every_three_by_three_feasibility_graph_with_tied_and_distinct_costs(self):
        for pattern in itertools.product((False, True), repeat=9):
            feasible = np.array(pattern).reshape(3, 3)
            for values in (np.full((3, 3), .2), np.arange(9).reshape(3, 3) / 20):
                self.compare(np.where(feasible, values, 1))

    def test_random_rectangular_graphs_and_permutations(self):
        rng = random.Random(19)
        for _ in range(250):
            rows, cols = rng.randint(1, 12), rng.randint(1, 12)
            cost = np.array([[rng.choice((1., rng.random(), .2)) for _ in range(cols)]
                             for _ in range(rows)])
            self.compare(cost)
            self.compare(cost.T)
            self.compare(cost[::-1, ::-1])

    def test_unbalanced_components_isolated_vertices_and_cardinality_before_cost(self):
        cost = np.ones((8, 9))
        cost[:3, 0] = [.4, .2, .3]
        cost[3, 1:4] = [.2, .1, .3]
        cost[4:6, 4:6] = [[.1, .2], [.2, 1.]]
        self.compare(cost)
        self.assertEqual(assign_gated(cost, .8)[0], [(1, 0), (3, 2), (4, 5), (5, 4)])

    def test_empty_no_edges_single_edges_and_dense_graphs(self):
        for cost in (np.empty((0, 4)), np.empty((3, 0)), np.ones((500, 500)),
                     np.diag(np.full(30, .1)) + (1 - np.eye(30)),
                     np.full((30, 40), .2)):
            self.compare(cost)


if __name__ == '__main__':
    unittest.main()
