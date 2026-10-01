"""Integration checks against a running app; set TEST_BASE_URL to change its URL."""

import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import joblib
import numpy as np
import pandas as pd

import main


BASE_URL = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8000')
PROFILE = {
    'person_age': 30,
    'person_income': 60000,
    'person_home_ownership': 'RENT',
    'person_emp_length': 5.0,
    'loan_intent': 'PERSONAL',
    'loan_grade': 'B',
    'loan_amnt': 10000,
    'loan_int_rate': 10.5,
    'loan_percent_income': 0.17,
    'cb_person_default_on_file': 'N',
    'cb_person_cred_hist_length': 8,
}


def request(path, body=None):
    req = Request(
        BASE_URL + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json'} if body is not None else {},
    )
    try:
        with urlopen(req, timeout=30) as response:
            return response.status, response.read(), response.headers
    except HTTPError as error:
        return error.code, error.read(), error.headers


class AppIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.model = joblib.load(root / 'Model.pkl')
        cls.threshold = float(joblib.load(root / 'threshold.pkl'))

    def test_page_assets_and_health(self):
        for path, content_type in [('/', 'text/html'), ('/static/styles.css', 'text/css'),
                                   ('/static/app.js', 'javascript'), ('/static/favicon.svg', 'image/svg+xml')]:
            with self.subTest(path=path):
                status, body, headers = request(path)
                self.assertEqual(status, 200)
                self.assertIn(content_type, headers['Content-Type'])
                self.assertTrue(body)
        status, body, _ = request('/health')
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)['model_loaded'])

    def test_predictions_match_saved_model(self):
        profiles = [PROFILE, {**PROFILE, 'person_income': 18000, 'loan_amnt': 25000,
                              'loan_int_rate': 22.0, 'loan_grade': 'G',
                              'cb_person_default_on_file': 'Y', 'loan_percent_income': 1.39}]
        for profile in profiles:
            with self.subTest(grade=profile['loan_grade']):
                status, body, _ = request('/predict', profile)
                self.assertEqual(status, 200, body)
                result = json.loads(body)
                expected = float(self.model.predict_proba(pd.DataFrame([profile]))[0, 1])
                self.assertAlmostEqual(result['default_probability'], expected)
                self.assertEqual(result['threshold'], self.threshold)
                prediction = int(expected >= self.threshold)
                self.assertEqual(result['default_prediction'], prediction)
                self.assertEqual(result['result'], 'High Risk' if prediction else 'Low Risk')

    def test_inconsistent_ratio_is_recalculated(self):
        _, baseline, _ = request('/predict', PROFILE)
        status, modified, _ = request('/predict', {**PROFILE, 'loan_percent_income': 999})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(baseline), json.loads(modified))

    def test_invalid_input_is_rejected(self):
        for field, value in [('person_income', 0), ('loan_amnt', -1), ('person_age', 17),
                             ('loan_int_rate', 101), ('loan_grade', 'Z'),
                             ('loan_intent', 'UNKNOWN'), ('person_home_ownership', 'UNKNOWN'),
                             ('cb_person_default_on_file', 'MAYBE'), ('person_emp_length', 31),
                             ('cb_person_cred_hist_length', 31)]:
            with self.subTest(field=field):
                status, body, _ = request('/predict', {**PROFILE, field: value})
                self.assertEqual(status, 422, body)
        status, _, _ = request('/predict', {})
        self.assertEqual(status, 422)

    def test_threshold_equality_is_high_risk(self):
        class BoundaryModel:
            def predict_proba(self, frame):
                return np.array([[0.4, 0.6]])

        with patch.dict(main.ml_model, {'model': BoundaryModel(), 'threshold': 0.6}, clear=True):
            result = main.predict(main.LoanApp(**PROFILE))
        self.assertEqual(result['default_prediction'], 1)
        self.assertEqual(result['result'], 'High Risk')


if __name__ == '__main__':
    unittest.main()
