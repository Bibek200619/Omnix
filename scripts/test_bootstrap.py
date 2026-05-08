import asyncio
import logging
import sys
import os

# Add backend to sys.path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from app.bootstrap.app import create_app

logging.basicConfig(level=logging.INFO)

async def test_startup():
    app = create_app()
    # Trigger startup events
    print("Running startup handlers...")
    for handler in app.router.on_startup:
        await handler()
    print("Startup complete!")
    
    # Trigger shutdown events
    print("Running shutdown handlers...")
    for handler in app.router.on_shutdown:
        await handler()
    print("Shutdown complete!")

if __name__ == "__main__":
    asyncio.run(test_startup())
