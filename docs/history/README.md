# Historical deployment configuration

`ec2-deploy-workflow.yml` preserves the former EC2 deployment workflow, including
the OCR worker deployment fix. It is outside `.github/workflows` and is not an
active GitHub Actions workflow.

Render is the backend deployment platform. Use the current Render service setup
and `render.yaml` for deployment configuration. Historical EC2 script tests do not
verify Render workers, queues, environment, or production readiness.
