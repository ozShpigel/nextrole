import asyncio, sys
sys.path.insert(0, '.')
from app.config import Settings
from app.services import subscore_eval, verdict_eval

all_cases = verdict_eval.load_golden_set()
target_ids = {"t-sil-01", "t-sil-02", "e-sil-01", "e-sil-02", "s-sil-01", "s-sil-02"}
cases = [c for c in all_cases if c["id"] in target_ids]
print(f"Running {len(cases)} cases: {[c['id'] for c in cases]}")

settings = Settings()
results = asyncio.run(subscore_eval.run_eval(settings, cases))
print(subscore_eval.format_report(results))
