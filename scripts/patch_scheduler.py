import sys

file_path = "backend/app/automation/scheduler.py"
with open(file_path, "r") as f:
    content = f.read()

old_code = """    async def start(self) -> None:
        \"\"\"Start the scheduler: load scheduled automations from DB and schedule them.\"\"\"
        logger.info("Starting AutomationScheduler...")
        try:
            # load automations (trusted reader)
            automations = await select_all_trusted("automations", "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id")
        except Exception as exc:
            logger.exception("Failed to load automations: %s", exc)
            automations = []

        for a in automations:"""

new_code = """    async def start(self) -> None:
        \"\"\"Start the scheduler: load scheduled automations from DB and schedule them.\"\"\"
        logger.info("Starting AutomationScheduler...")
        automations = []
        try:
            # load automations (trusted reader)
            automations = await select_all_trusted("automations", "id,workspace_id,name,job_type,schedule,interval_seconds,enabled,user_id")
        except Exception as exc:
            logger.error(f"Failed to load automations (DB/key missing?): {exc}")

        for a in automations:"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, "w") as f:
        f.write(content)
    print("Patched scheduler.py successfully")
else:
    print("Could not find the exact code block to patch.")
