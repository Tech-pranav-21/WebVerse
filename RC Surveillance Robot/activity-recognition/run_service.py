"""
Startup script for the Local Human Pose Detection Service.
Runs uvicorn with configured host, port, and graceful shutdown handling.
"""

import sys
import uvicorn
from config import SERVICE_HOST, SERVICE_PORT

if __name__ == "__main__":
    print(f"Starting Local Human Pose Detection Service on http://{SERVICE_HOST}:{SERVICE_PORT}")
    print("Swagger API Docs available at http://{SERVICE_HOST}:{SERVICE_PORT}/docs")
    try:
        uvicorn.run("service:app", host=SERVICE_HOST, port=SERVICE_PORT, log_level="info", reload=False)
    except KeyboardInterrupt:
        print("\nService shutdown requested by user.")
        sys.exit(0)
