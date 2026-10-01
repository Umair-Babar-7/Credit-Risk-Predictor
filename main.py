from contextlib import asynccontextmanager
import math
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import joblib
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator


BASE_DIR = Path(__file__).resolve().parent
ml_model = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    ml_model['model'] = joblib.load(BASE_DIR / 'Model.pkl')
    ml_model['threshold'] = float(joblib.load(BASE_DIR / 'threshold.pkl'))
    if not math.isfinite(ml_model['threshold']) or not 0 <= ml_model['threshold'] <= 1:
        raise ValueError('The saved decision threshold must be between 0 and 1.')
    yield
    ml_model.clear()


app = FastAPI(title='Credence | Credit Risk API', lifespan=lifespan)
app.mount('/static', StaticFiles(directory=BASE_DIR / 'static'), name='static')


class LoanApp(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    person_age: int = Field(ge=18, le=100)
    person_income: int = Field(gt=0)
    person_home_ownership: Literal['RENT', 'OWN', 'MORTGAGE', 'OTHER']
    person_emp_length: float = Field(ge=0)
    loan_intent: Literal['PERSONAL', 'EDUCATION', 'MEDICAL', 'VENTURE', 'HOMEIMPROVEMENT', 'DEBTCONSOLIDATION']
    loan_grade: Literal['A', 'B', 'C', 'D', 'E', 'F', 'G']
    loan_amnt: int = Field(gt=0)
    loan_int_rate: float = Field(gt=0, le=100)
    loan_percent_income: float = Field(ge=0)
    cb_person_default_on_file: Literal['N', 'Y']
    cb_person_cred_hist_length: int = Field(ge=0)

    @model_validator(mode='after')
    def validate_profile(self):
        if self.person_emp_length > self.person_age:
            raise ValueError('Employment length cannot exceed applicant age.')
        if self.cb_person_cred_hist_length > self.person_age:
            raise ValueError('Credit history cannot exceed applicant age.')
        # Preserve the API field while deriving it from the source values.
        # Training data records this ratio to two decimal places.
        self.loan_percent_income = round(self.loan_amnt / self.person_income, 2)
        return self


@app.get('/')
def home():
    return FileResponse(BASE_DIR / 'static' / 'index.html')


@app.get('/health')
def health():
    return {'status': 'ok', 'model_loaded': 'model' in ml_model}


@app.post('/predict')
def predict(data: LoanApp):
    input_df = pd.DataFrame([data.model_dump()])
    probability = float(ml_model['model'].predict_proba(input_df)[:, 1][0])
    prediction = int(probability >= ml_model['threshold'])
    return {
        'default_probability': probability,
        'default_prediction': prediction,
        'threshold': ml_model['threshold'],
        'result': 'High Risk' if prediction == 1 else 'Low Risk',
    }

{
  "person_age": 24,
  "person_income": 22000,
  "person_home_ownership": "RENT",
  "person_emp_length": 1,
  "loan_intent": "DEBTCONSOLIDATION",
  "loan_grade": "F",
  "loan_amnt": 18000,
  "loan_int_rate": 20.5,
  "loan_percent_income": 0.82,
  "cb_person_default_on_file": "Y",
  "cb_person_cred_hist_length": 3
}