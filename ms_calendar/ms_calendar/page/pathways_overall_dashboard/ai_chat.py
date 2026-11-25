"""
"Ask AI" chat on the Pathways Overall Dashboard (2026-11-24, ms.local first).

The user types a question; Claude answers it by calling the tools below, which
reuse this dashboard's own functions (same permission-scoped SQL, same
filters). The tools return COUNTS ONLY: no applicant names, emails, phone
numbers, referrer emails or interviewer names are ever sent to the AI.

Setup (site_config.json of the site) — ONE of:
    "anthropic_api_key": "sk-ant-..."          Anthropic directly (model claude-opus-5-5)
    "openrouter_api_key": "sk-or-v1-..."       via OpenRouter (model anthropic/claude-opus-5.5)
Optional:
    "pathways_ai_model": "..."                 another model id for that provider
    "pathways_ai_mode": "offline"              force the free keyword mode
With no key the chat runs in the free offline mode (ask_offline.py).
"""

import json

import frappe
from frappe.utils import cint, nowdate

from ms_calendar.ms_calendar.page.pathways_overall_dashboard import pathways_overall_dashboard as pod

DEFAULT_MODEL = "claude-opus-5-5"
OPENROUTER_MODEL = "anthropic/claude-opus-5.5"
OPENROUTER_BASE_URL = "https://openrouter.ai/api"   # OpenRouter's Anthropic-compatible Messages endpoint
MAX_TOOL_ROUNDS = 8           # tool calls per question before we stop the loop
MAX_HISTORY_TURNS = 10        # earlier question/answer pairs sent back for context
QUESTIONS_PER_HOUR = 40       # per user
UNIT_LABELS = [c["unit_label"] for c in pod.PROGRAMS]
LIST_FILTERS = ("units", "subunits", "locations", "job_codes", "job_openings", "roles")

# ── what the model may call ────────────────────────────────────────────────

_FILTERS_SCHEMA = {
    "type": "object",
    "description": "Optional. Leave a key out to use the filter currently applied on the dashboard. "
                   "Dates are application dates (YYYY-MM-DD); set both to null for all time.",
    "properties": {
        "from_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, or null for no start date"},
        "to_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, or null for no end date"},
        "units": {"type": "array", "items": {"type": "string", "enum": UNIT_LABELS},
                  "description": "Units to include; empty list = all units"},
        "subunits": {"type": "array", "items": {"type": "string"}},
        "locations": {"type": "array", "items": {"type": "string"}},
        "job_codes": {"type": "array", "items": {"type": "string"}},
        "roles": {"type": "array", "items": {"type": "string"}},
    },
    "additionalProperties": False,
}

_ANALYTICS_SECTIONS = {
    "units": "Funnel per unit: registrations and how many reached CV shortlist, leadership round, offer, "
             "offer accepted, joined.",
    "job_openings": "The same funnel per job code / role (largest first; use `search` to find one).",
    "monthly_by_job": "Registrations per month for the busiest job openings.",
    "sources": "Where applicants heard about the job (source) with the funnel for each.",
    "gender": "Gender split with the funnel, overall and per unit.",
    "education": "Highest education with the funnel.",
    "age_band": "Age bands with the funnel.",
    "home_state": "Home state with the funnel.",
    "decline_reasons": "Why candidates declined offers (counts).",
    "reject_reasons": "Recorded rejection reasons (counts).",
    "stage_time": "Days spent at each hiring step (median / average), overall and per unit, and who owns it.",
    "time_to_milestone": "Days from application to each milestone (median, average, count) per unit.",
    "feedback_turnaround": "Days from interview to feedback per unit, and how many are pending.",
    "data_coverage": "How many records have each analytics field filled in.",
}

TOOLS = [
    {
        "name": "get_dashboard_summary",
        "description": "Headline numbers for the chosen filters: Total Applicants, Total Select, Total Reject, "
                       "Total Offer process, Total Joined, applicants per stage and per unit, every pipeline "
                       "board card (e.g. CV Shortlist, Test Select, Recruiter Round, Feedback Pending, Offer "
                       "Sent, Joined, Interviews Today, Next 7 Days) with its count per unit, and all-time "
                       "registrations. Start here for most questions.",
        "input_schema": {"type": "object", "properties": {"filters": _FILTERS_SCHEMA},
                         "additionalProperties": False},
    },
    {
        "name": "get_step_breakdown",
        "description": "Total Select or Total Reject split into steps (e.g. CV Shortlist, Test Select, Recruiter "
                       "Round Select, Functional Round Select, Final Round Select, Test In Progress, On Hold … / "
                       "CV Reject, Test Reject, No Show, Recruiter Round Reject …), each with its count per unit "
                       "and exactly which Application Status values (from which form and field) it counts.",
        "input_schema": {
            "type": "object",
            "properties": {"view": {"type": "string", "enum": ["select", "reject"]}, "filters": _FILTERS_SCHEMA},
            "required": ["view"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_status_counts",
        "description": "Raw count of applicants per Application Status value per unit (with the stage each "
                       "status belongs to: New / In process / On hold / Offer / Selected / Not selected). Use "
                       "it for any status the other tools don't name.",
        "input_schema": {"type": "object", "properties": {"filters": _FILTERS_SCHEMA},
                         "additionalProperties": False},
    },
    {
        "name": "get_analytics",
        "description": "One section of the Analytics tab. Sections: "
                       + "; ".join(f"{k} = {v}" for k, v in _ANALYTICS_SECTIONS.items()),
        "input_schema": {
            "type": "object",
            "properties": {
                "section": {"type": "string", "enum": list(_ANALYTICS_SECTIONS)},
                "search": {"type": "string",
                           "description": "job_openings only: part of a job code or role name to look for"},
                "filters": _FILTERS_SCHEMA,
            },
            "required": ["section"],
            "additionalProperties": False,
        },
    },
]

SYSTEM_PROMPT = f"""You are the "Ask AI" assistant on the Pathways Overall Dashboard of the Azim Premji \
Foundation recruitment system. Recruiters and managers ask you about hiring numbers.

How to answer:
- Get every number from the tools. Never estimate or invent a number; if the tools can't answer, say so \
and say what the dashboard can show instead.
- The dashboard's current filters are given with each question. Use them unless the question names other \
dates or units (then pass those in `filters`). Say which date range and units your answer covers.
- Units: {", ".join(UNIT_LABELS)}. "Grants" is Philanthropy (Phil Registration Form). Each unit has its own \
registration form; its Application Status field decides every count.
- Total Select = applicants still moving forward (stages In process, On hold, Offer / Selected). Total Reject = \
stage Not selected. Total Applicants = New + Select + Reject. Total Offer process = documents, fitment, \
compensation, offer, onboarding (not yet joined). Total Joined = Joined or ERP ID stage.
- When you give a count, name the step or status it comes from (e.g. "Test Select 845 — status Test Select on \
Field Registration Form"). Use a small markdown table when comparing units or steps. Keep answers short and \
plain; recruiters read them between tasks.
- Percentages: say what they are a share of.
- You only see counts. You cannot see or list applicant names, emails, phone numbers, referrers or \
interviewer names. If asked, say that the dashboard list (click the card) shows them.
- Answer in the language the user writes in (English, Hindi, Tamil, Kannada, etc.)."""


# ── entry point ───────────────────────────────────────────────────────────

@frappe.whitelist()
def ask(question, history=None, filters=None):
    """One chat turn. Returns {"answer": markdown, "steps": [...]} or {"error": ..., "message": ...}."""
    if frappe.session.user == "Guest" or frappe.get_cached_value("User", frappe.session.user, "user_type") != "System User":
        frappe.throw("Only desk users can use Ask AI.", frappe.PermissionError)
    question = (question or "").strip()[:2000]
    if not question:
        return {"error": "empty", "message": "Type a question first."}

    page_filters = _clean_filters(_loads(filters) or {})

    # No (real) key, or offline forced → the free keyword mode; no AI service is called.
    provider = _provider()
    if frappe.conf.get("pathways_ai_mode") == "offline" or not provider:
        from ms_calendar.ms_calendar.page.pathways_overall_dashboard import ask_offline

        answer, steps = ask_offline.answer(question, page_filters)
        return {"answer": answer, "steps": steps, "mode": "offline"}

    if not _within_rate_limit():
        return {"error": "rate_limited",
                "message": f"You have asked {QUESTIONS_PER_HOUR} questions in the last hour. Please try again later."}

    messages = _history_messages(_loads(history) or [])
    messages.append({"role": "user", "content": (
        f"Today is {nowdate()}. Dashboard filters now applied: {json.dumps(_describe(page_filters))}\n\n"
        f"Question: {question}")})

    try:
        answer, steps, usage = _run(provider, messages, page_filters)
    except Exception as e:  # noqa: BLE001 — turn every SDK failure into a readable message
        return {"error": "ai_error", "message": _error_message(e)}

    frappe.logger("pathways_ai").info({"user": frappe.session.user, "question": question[:300],
                                       "tools": [s["tool"] for s in steps], "usage": usage})
    return {"answer": answer, "steps": steps, "mode": "ai"}


def _looks_like_key(key, prefix="sk-ant-"):
    """A real key, not empty and not the example text from the setup instructions."""
    return key.startswith(prefix) and len(key) > 40 and "PASTE" not in key.upper()


def _provider():
    """("anthropic" | "openrouter", key) from the site config, or None when no real key is set."""
    ant = (frappe.conf.get("anthropic_api_key") or "").strip()
    if _looks_like_key(ant):
        return ("anthropic", ant)
    ork = (frappe.conf.get("openrouter_api_key") or "").strip()
    for k in (ork, ant):                       # an OpenRouter key pasted into either setting
        if _looks_like_key(k, "sk-or-"):
            return ("openrouter", k)
    return None


def _run(provider, messages, page_filters):
    import anthropic

    kind, key = provider
    common = dict(max_tokens=16000, system=SYSTEM_PROMPT, tools=TOOLS,
                  output_config={"effort": "medium"}, cache_control={"type": "ephemeral"})
    if kind == "openrouter":
        # OpenRouter speaks the Anthropic Messages API; the key goes in as a bearer token.
        client = anthropic.Anthropic(api_key=None, auth_token=key, base_url=OPENROUTER_BASE_URL,
                                     timeout=110.0, max_retries=1)
        model = frappe.conf.get("pathways_ai_model") or OPENROUTER_MODEL

        def create():
            return client.messages.create(model=model, messages=messages, **common)
    else:
        client = anthropic.Anthropic(api_key=key, timeout=110.0, max_retries=1)
        model = frappe.conf.get("pathways_ai_model") or DEFAULT_MODEL

        def create():
            # On a safety decline the API re-runs the request on a fallback model by itself.
            return client.beta.messages.create(model=model, messages=messages, **common,
                                               betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    steps, usage = [], {"input": 0, "output": 0, "cache_read": 0}

    for _ in range(MAX_TOOL_ROUNDS + 1):
        response = create()
        u = response.usage
        usage["input"] += u.input_tokens or 0
        usage["output"] += u.output_tokens or 0
        usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0

        if response.stop_reason == "refusal":
            return "Sorry, I can't help with that question. Try asking about the hiring numbers.", steps, usage
        if response.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": response.content})
            continue
        tool_calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not tool_calls:
            text = "\n\n".join(b.text for b in response.content if b.type == "text").strip()
            if response.stop_reason == "max_tokens":
                text += "\n\n_(The answer was cut short — ask a narrower question.)_"
            return text or "I couldn't find an answer to that.", steps, usage

        # Keep the assistant turn exactly as returned (thinking blocks included).
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for call in tool_calls:
            steps.append({"tool": call.name, "input": call.input})
            try:
                out = _call_tool(call.name, call.input or {}, page_filters)
                results.append({"type": "tool_result", "tool_use_id": call.id,
                                "content": json.dumps(out, default=str)})
            except Exception as e:  # noqa: BLE001 — report the failure to the model, don't crash
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                "content": f"Error: {str(e)[:300]}"})
        messages.append({"role": "user", "content": results})

    return "That question needed too many lookups. Please ask something more specific.", steps, usage


# ── tools (counts only) ───────────────────────────────────────────────────

def _call_tool(name, args, page_filters):
    f = dict(page_filters)
    f.update(_clean_filters(args.get("filters") or {}))
    kw = _kw(f)
    if name == "get_dashboard_summary":
        return _summary(kw)
    if name == "get_step_breakdown":
        view = args.get("view")
        if view not in pod.STEP_SETS:
            raise ValueError("view must be select or reject")
        return _steps(kw, view)
    if name == "get_status_counts":
        return _status_counts(kw)
    if name == "get_analytics":
        return _analytics_section(kw, args.get("section"), args.get("search"))
    raise ValueError(f"unknown tool {name}")


def _summary(kw):
    d = pod.get_dashboard_data(**kw)
    units = {u["program"]: u["unit"] for u in d.get("units_in_scope") or []}
    stages, per_unit = {}, {}
    for fn in d.get("funnel") or []:
        per_unit[units.get(fn["program"], fn["program"])] = fn["registrations"]
        for k, v in (fn.get("stages") or {}).items():
            stages[k] = stages.get(k, 0) + v
    total = sum(per_unit.values())
    fc = {c["key"]: c for c in d.get("funnel_cards") or []}

    def by_unit(rows):
        return {r["unit"]: r["value"] for r in rows or [] if r.get("value") is not None}

    board = []
    for g in d.get("board") or []:
        for it in g["items"]:
            for c in it["cards"]:
                board.append({"section": g["title"], "card": c["label"], "count": c["value"],
                              "by_unit": by_unit(c.get("by_unit")),
                              "counts": "interviews" if c.get("kind") != "card" else "applicants"})
    return {
        "filters": _describe(_from_kw(kw)),
        "total_applicants": total,
        "total_select": stages.get("In process", 0) + stages.get("On hold", 0) + stages.get("Offer / Selected", 0),
        "total_reject": stages.get("Not selected", 0),
        "new_applicants": stages.get("New", 0),
        "total_offer_process": (fc.get("offer_process") or {}).get("value"),
        "total_joined": (fc.get("reach_joined") or {}).get("value"),
        "reached_at_least": {fc[k]["label"]: fc[k]["value"] for k in ("reach_cv", "reach_leader", "reach_accepted")
                             if k in fc},
        "applicants_by_stage": stages,
        "applicants_by_unit": per_unit,
        "board_cards": board,
        "all_time_registrations_ignoring_filters": d.get("all_time_registrations"),
    }


def _steps(kw, view):
    d = pod.get_dashboard_data(**kw)
    out = []
    for g in (d.get("step_groups") or {}).get(view) or []:
        out.append({
            "step": g["label"], "meaning": g["desc"], "group": g.get("section"), "count": g["value"],
            "by_unit": {u["unit"]: u["value"] for u in g.get("by_unit") or []},
            "counted_from": [{"unit": s["unit"], "form": s["doctype"], "field": s["field"],
                              "statuses": dict(s["statuses"])} for s in g.get("sources") or []],
        })
    return {"filters": _describe(_from_kw(kw)), "view": view, "total": sum(s["count"] for s in out), "steps": out}


def _status_counts(kw):
    d = pod.get_dashboard_data(**kw)
    unit = {c["key"]: c["unit_label"] for c in pod.PROGRAMS}
    rows = [{"unit": unit.get(r["program"], r["program"]), "status": r["status"], "stage": r["stage"],
             "count": r["count"]} for r in d.get("status_rows") or []]
    return {"filters": _describe(_from_kw(kw)), "rows": rows}


def _analytics_section(kw, section, search=None):
    if section not in _ANALYTICS_SECTIONS:
        raise ValueError("unknown section")
    a = pod.get_analytics(**kw)
    key = {"job_openings": "jds", "monthly_by_job": "jd_heat", "decline_reasons": "decline",
           "reject_reasons": "reject", "stage_time": "steps", "time_to_milestone": "time_to",
           "feedback_turnaround": "turnaround", "data_coverage": "coverage"}.get(section, section)
    data = a.get(key)
    if section == "job_openings":
        rows = data or []
        if search:
            s = str(search).lower()
            rows = [r for r in rows if s in str(r.get("job_code", "")).lower() or s in str(r.get("role", "")).lower()]
        rows = sorted(rows, key=lambda r: -(r.get("reg") or 0))
        data = {"total_openings": len(rows), "rows": rows[:40]}
    if section == "gender":
        data = {"overall": a.get("gender"), "per_unit": a.get("gender_units")}
    if section == "stage_time":
        data = {"steps": a.get("steps"), "owners": a.get("owners")}
    return {"filters": _describe(_from_kw(kw)), "section": section,
            "milestones": a.get("milestones"), "data": data}


# ── helpers ───────────────────────────────────────────────────────────────

def _loads(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return v


def _clean_filters(f):
    """Only known keys, plain values; dates validated, units limited to the real unit names."""
    out = {}
    if not isinstance(f, dict):
        return out
    for k in ("from_date", "to_date"):
        if k in f:
            v = f.get(k)
            out[k] = str(frappe.utils.getdate(v)) if v else None
    for k in LIST_FILTERS:
        if k in f:
            vals = f.get(k) or []
            vals = [str(x)[:140] for x in (vals if isinstance(vals, list) else [vals]) if x not in (None, "")]
            if k == "units":
                vals = [v for v in vals if v in UNIT_LABELS]
            out[k] = vals[:50]
    return out


def _kw(f):
    kw = {"from_date": f.get("from_date"), "to_date": f.get("to_date"), "programs": [], "stages": []}
    for k in LIST_FILTERS:
        kw[k] = f.get(k) or []
    return kw


def _from_kw(kw):
    return {k: kw.get(k) for k in ("from_date", "to_date") + LIST_FILTERS}


def _describe(f):
    d = {"applied_from": f.get("from_date") or "no start (all time)", "applied_to": f.get("to_date") or "today"}
    for k in LIST_FILTERS:
        d[k] = f.get(k) or "all"
    return d


def _history_messages(history):
    """Earlier turns as plain text (the last few), alternating user / assistant."""
    out = []
    for h in history[-MAX_HISTORY_TURNS * 2:]:
        if not isinstance(h, dict):
            continue
        role = h.get("role")
        text = str(h.get("content") or "").strip()[:4000]
        if role in ("user", "assistant") and text:
            if out and out[-1]["role"] == role:
                out[-1]["content"] += "\n\n" + text
            else:
                out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    if out and out[-1]["role"] == "user":      # the new question is appended next
        out.pop()
    return out


def _within_rate_limit():
    """At most QUESTIONS_PER_HOUR per user per clock hour."""
    key = f"pathways_ai:rate:{frappe.session.user}:{frappe.utils.now_datetime().strftime('%Y%m%d%H')}"
    n = cint(frappe.cache.get_value(key))
    if n >= QUESTIONS_PER_HOUR:
        return False
    frappe.cache.set_value(key, n + 1, expires_in_sec=3700)
    return True


def _error_message(e):
    import anthropic

    if isinstance(e, anthropic.AuthenticationError):
        return ("The AI key on this site is not valid. Ask an administrator to check "
                "`anthropic_api_key` / `openrouter_api_key`.")
    if isinstance(e, anthropic.APIStatusError) and e.status_code == 402:
        return ("The AI account has no credit left (or the key's spending limit is reached). "
                "Add credit on OpenRouter / Anthropic, then ask again.")
    if isinstance(e, anthropic.PermissionDeniedError):
        return "The AI key on this site is not allowed to use this model."
    if isinstance(e, anthropic.RateLimitError):
        return "The AI service is busy right now. Please try again in a minute."
    if isinstance(e, anthropic.APITimeoutError):
        return "The AI took too long to answer. Please try a simpler question."
    if isinstance(e, anthropic.APIConnectionError):
        return "Could not reach the AI service. Check the internet connection of the server."
    if isinstance(e, anthropic.BadRequestError) and "credit" in str(e).lower():
        return ("The Anthropic account has no credit left. Add funds in the Claude Console "
                "(Plans & Billing / Add funds), then ask again.")
    if isinstance(e, anthropic.APIStatusError):
        frappe.log_error(f"Ask AI: {e.status_code} {str(e)[:500]}", "Pathways Ask AI")
        return f"The AI service returned an error ({e.status_code}). Please try again."
    frappe.log_error(frappe.get_traceback(), "Pathways Ask AI")
    return "Something went wrong while answering. The error has been logged."
