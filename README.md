# Credence — Credit Risk Assessment

A responsive HTML, CSS and vanilla JavaScript interface for the existing calibrated XGBoost credit risk model. FastAPI serves the website and prediction API together, so one Render web service hosts the entire application.

## Files

```text
main.py                 FastAPI application, validation and model inference
static/index.html       Page markup and assessment form
static/styles.css       Responsive design
static/app.js           Validation, live summary, prediction and JSON download
static/favicon.svg      Application icon
Model.pkl               Existing saved model (required for deployment)
threshold.pkl           Existing saved threshold (required for deployment)
requirements.txt        Runtime dependencies pinned to the working environment
.python-version         Render Python runtime selection
render.yaml             Render Blueprint configuration
tests/test_app.py       API and saved-model integration checks
```

## Run locally

Use Python 3.12.10. From the project directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload
```

The existing environment can also run the app:

```powershell
.\.venv312\Scripts\python.exe -m uvicorn main:app --reload
```

Open <http://127.0.0.1:8000>. Use **Try an example**, then **Assess credit risk** to test the complete flow. Interactive API documentation is at `/docs` and service health is at `/health`. Open the page through FastAPI; opening the HTML directly will not connect to the API.

## Deploy on Render

1. Push this project to your GitHub or GitLab repository. Include `Model.pkl`, `threshold.pkl`, the entire `static` folder, `main.py`, `requirements.txt`, `.python-version` and `render.yaml`. Do not upload your virtual environment. The notebook and training CSV are not required to serve predictions.
2. In Render, choose **New → Blueprint**, connect the repository and apply `render.yaml`.
3. Alternatively, choose **New → Web Service**, select the repository and use:

   | Setting | Value |
   | --- | --- |
   | Language | Python 3 |
   | Build command | `pip install -r requirements.txt` |
   | Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
   | Health check path | `/health` |
   | Environment variable | `PYTHON_VERSION=3.12.10` |
   | Environment variable | `OMP_NUM_THREADS=1` |

4. Open the service URL after deployment. The root URL serves the frontend; predictions use the same origin at `/predict`.

Render uses **`.python-version`**, not a Heroku-style `runtime.txt`, to select the Python runtime. This project also sets `PYTHON_VERSION` in its Blueprint; keep both values consistent. See [Render Python versions](https://render.com/docs/python-version) and [Render FastAPI deployment](https://render.com/docs/deploy-fastapi). The deployment is configured for a single process to avoid loading multiple model copies. If using a sleeping service tier, allow time for startup on the first visit.

## Prediction behavior

- The original `/predict` response fields remain available: `default_probability`, `default_prediction`, `threshold` and `result`.
- The original 11 input fields are accepted. Categories match the training data exactly. Numeric values must be finite; the API also validates age (18–100), positive income and loan amount, interest (greater than 0 up to 100), and nonnegative employment/credit history that cannot exceed age.
- `loan_percent_income` remains an API input for compatibility, but the server recalculates it as `round(loan_amnt / person_income, 2)` to prevent contradictory inputs and match the dataset's precision. The live UI ratio displays the unrounded calculation as a percentage.
- Classification uses the threshold loaded from `threshold.pkl`; no threshold or predictions are invented in the UI. The saved model and notebook are not modified.
- Editing the form clears the previous assessment and cancels any pending browser request, preventing stale results. Predictions can be downloaded as JSON. No applicant history is saved by this application.
- Values are labeled in USD to match the source credit risk dataset. The result is a model estimate, not a lending decision.
- Google Fonts enhances the typography; local system fonts are used if that service is unavailable. There are no JavaScript libraries, frontend build steps or external prediction services.

## Checks

With the server running locally:

```powershell
.\.venv312\Scripts\python.exe -m unittest discover -s tests -v
```

The tests use the Python standard library and the running local server. They cover static assets, the saved model's real predictions, invalid input, server-side ratio calculation and the decision boundary. They do not retrain or overwrite model files.
