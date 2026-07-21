import sys
import os

# Ensure repo root is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app as application
from vercel_wsgi import handler

# Vercel serverless entrypoint
app = handler(application)
