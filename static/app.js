'use strict';

const form = document.querySelector('#assessment-form');
const resultCard = document.querySelector('#result-card');
const submitButton = document.querySelector('#submit-button');
const errorBox = document.querySelector('#form-error');
const downloadButton = document.querySelector('#download-button');
const guide = document.querySelector('#guide-dialog');
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const numericFields = ['person_age', 'person_income', 'person_emp_length', 'loan_amnt', 'loan_int_rate', 'cb_person_cred_hist_length'];
let currentRequest = null;
let lastAssessment = null;

const example = {
  person_age: 30,
  person_income: 60000,
  person_home_ownership: 'RENT',
  person_emp_length: 5,
  loan_intent: 'PERSONAL',
  loan_grade: 'B',
  loan_amnt: 10000,
  loan_int_rate: 10.5,
  cb_person_default_on_file: 'N',
  cb_person_cred_hist_length: 8,
};

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function setBusy(busy) {
  submitButton.disabled = busy;
  resultCard.setAttribute('aria-busy', String(busy));
  setText('#submit-label', busy ? 'Assessing profile…' : 'Assess credit risk');
}

function clearResult() {
  if (currentRequest) {
    currentRequest.abort();
    currentRequest = null;
  }
  lastAssessment = null;
  setBusy(false);
  resultCard.removeAttribute('data-state');
  document.querySelector('#result-title').innerHTML = 'A little data.<br>A lot more clarity.';
  setText('#result-subtitle', 'Your assessment starts with the details.');
  document.querySelector('#probability').innerHTML = '—<span>%</span>';
  document.querySelector('#gauge-fill').style.strokeDashoffset = '100';
  document.querySelector('#gauge-fill').style.opacity = '0';
  setText('#result-status-text', 'Awaiting assessment');
  setText('#result-explanation', 'Complete the applicant profile to see the model’s estimated probability of default.');
  setText('#threshold-value', 'Set by your model');
  downloadButton.hidden = true;
  errorBox.hidden = true;
}

function updateSummary() {
  const income = Number(form.elements.person_income.value);
  const amount = Number(form.elements.loan_amnt.value);
  const ratio = income > 0 && amount > 0 ? amount / income * 100 : null;
  document.querySelector('#income-ratio').innerHTML = `${ratio !== null && Number.isFinite(ratio) ? ratio.toFixed(1) : '—'}<span>%</span>`;
  setText('#summary-loan', amount > 0 && Number.isFinite(amount) ? money.format(amount) : '—');
  setText('#summary-income', income > 0 && Number.isFinite(income) ? money.format(income) : '—');
  const purpose = form.elements.loan_intent;
  setText('#summary-purpose', purpose.value ? purpose.selectedOptions[0].textContent : '—');
  const age = Number(form.elements.person_age.value);
  for (const [name, label] of [['person_emp_length', 'Employment length'], ['cb_person_cred_hist_length', 'Credit history']]) {
    const field = form.elements[name];
    field.setCustomValidity(age > 0 && Number(field.value) > age ? `${label} cannot exceed applicant age.` : '');
  }
}

function readProfile() {
  const profile = Object.fromEntries(new FormData(form));
  for (const name of numericFields) profile[name] = Number(profile[name]);
  // The backend derives and rounds this feature to match the training data.
  profile.loan_percent_income = profile.loan_amnt / profile.person_income;
  return profile;
}

function displayResult(result, profile) {
  const highRisk = result.default_prediction === 1;
  const percentage = result.default_probability * 100;
  resultCard.dataset.state = highRisk ? 'high' : 'low';
  setText('#result-title', highRisk ? 'A closer look is needed.' : 'A clearer view of the risk.');
  setText('#result-subtitle', 'Assessment complete · Based on the current profile');
  document.querySelector('#probability').innerHTML = `${percentage.toFixed(1)}<span>%</span>`;
  document.querySelector('#gauge-fill').style.opacity = percentage > 0 ? '1' : '0';
  document.querySelector('#gauge-fill').style.strokeDashoffset = String(100 - percentage);
  setText('#result-status-text', `${result.result} · ${percentage.toFixed(1)}% estimated default probability`);
  setText('#result-explanation', highRisk
    ? 'The estimated default probability is at or above the model’s decision threshold. Review this profile in its full context.'
    : 'The estimated default probability is below the model’s decision threshold. Low risk does not mean zero risk.');
  setText('#threshold-value', `${(result.threshold * 100).toFixed(1)}%`);
  lastAssessment = { assessed_at: new Date().toISOString(), applicant: profile, assessment: result };
  downloadButton.hidden = false;
  if (window.matchMedia('(max-width: 1020px)').matches) {
    resultCard.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
}

form.addEventListener('input', () => {
  clearResult();
  updateSummary();
});
form.addEventListener('change', () => {
  clearResult();
  updateSummary();
});
form.addEventListener('reset', () => {
  clearResult();
  // The reset event occurs before the browser restores the form controls.
  requestAnimationFrame(updateSummary);
});

document.querySelector('#example-button').addEventListener('click', () => {
  clearResult();
  for (const [name, value] of Object.entries(example)) form.elements[name].value = value;
  updateSummary();
  form.elements.person_age.focus({ preventScroll: true });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  updateSummary();
  if (!form.reportValidity()) return;
  clearResult();
  const profile = readProfile();
  const controller = new AbortController();
  currentRequest = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 60000);
  setBusy(true);
  resultCard.dataset.state = 'loading';
  setText('#result-status-text', 'Analyzing applicant profile…');
  try {
    const response = await fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = 'The model could not complete this assessment. Please try again.';
      if (response.status === 422) {
        const body = await response.json();
        message = Array.isArray(body.detail) ? body.detail.map((item) => `${item.loc?.slice(1).join(' ') || 'Profile'}: ${item.msg}`).join(' • ') : 'Please check the applicant details and try again.';
      }
      throw new Error(message);
    }
    const result = await response.json();
    if (![result.default_probability, result.threshold].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
      || ![0, 1].includes(result.default_prediction)
      || !['High Risk', 'Low Risk'].includes(result.result)) {
      throw new Error('The model returned an unexpected response. Please try again.');
    }
    if (currentRequest !== controller) return;
    displayResult(result, profile);
    setModelStatus(true);
  } catch (error) {
    if (currentRequest !== controller) return;
    resultCard.dataset.state = 'error';
    setText('#result-status-text', 'Assessment unavailable');
    setText('#result-explanation', 'Your details are still in the form. Please try your assessment again.');
    errorBox.textContent = timedOut
      ? 'The server is taking longer than expected. It may be starting up. Please try again in a moment.'
      : error instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : error.message;
    errorBox.hidden = false;
  } finally {
    clearTimeout(timeout);
    if (currentRequest === controller) {
      currentRequest = null;
      setBusy(false);
    }
  }
});

downloadButton.addEventListener('click', () => {
  if (!lastAssessment) return;
  const blob = new Blob([JSON.stringify(lastAssessment, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `credence-assessment-${lastAssessment.assessed_at.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

for (const trigger of document.querySelectorAll('[data-open-guide]')) trigger.addEventListener('click', () => guide.showModal());
document.querySelector('#close-guide').addEventListener('click', () => guide.close());
guide.addEventListener('click', (event) => {
  const rect = guide.getBoundingClientRect();
  if (event.target === guide && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) guide.close();
});

function setModelStatus(ready) {
  setText('#model-status', ready ? 'Model ready' : 'Connection unavailable');
  document.querySelector('#status-dot').className = `status-dot ${ready ? 'ready' : 'offline'}`;
}

async function checkHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/health', { signal: controller.signal });
    const data = await response.json();
    setModelStatus(response.ok && data.model_loaded === true);
  } catch {
    setModelStatus(false);
  } finally {
    clearTimeout(timeout);
  }
}

updateSummary();
checkHealth();
