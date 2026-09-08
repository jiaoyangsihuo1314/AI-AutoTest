import os
import secrets


os.environ.setdefault("QA_BOOTSTRAP_ADMIN_PASSWORD", f"TestA1{secrets.token_urlsafe(24)}")
