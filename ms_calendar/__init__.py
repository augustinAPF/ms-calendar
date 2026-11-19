import os

__version__ = "0.0.1"

# wkhtmltopdf (Qt) stalls on two system lookups before rendering, which made
# a single frappe.get_print PDF take 30–90s at random on a desktop machine
# (the interview PDF check took 116s for 3 PDFs):
#  - it asks the CUPS printer service for printers and waits up to 60s when
#    CUPS doesn't answer → point it at a CUPS server that doesn't exist so the
#    lookup fails instantly (no PDF ever needs a printer);
#  - it polls network interfaces ("bearer management") every 10s → off.
# With both, each PDF is a steady ~0.4s. Child wkhtmltopdf processes inherit
# these; harmless where neither lookup stalls (e.g. Frappe Cloud containers).
os.environ.setdefault("CUPS_SERVER", "/nonexistent/cups.sock")
os.environ.setdefault("QT_BEARER_POLL_TIMEOUT", "-1")
