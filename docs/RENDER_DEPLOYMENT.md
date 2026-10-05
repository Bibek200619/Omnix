# Backend deployment

Omnix's backend is deployed on Render. Render is connected to this repository's `main` branch with automatic deployment enabled for new commits.

- Service: `omnix-backend`
- Dashboard: https://dashboard.render.com/web/srv-dapeo24ja7ms73b2sku0
- Backend URL: https://omnix-backend-bic3.onrender.com
- Plan: Free
- Build command: `cd backend && pip install -r requirements.txt`
- Start command: `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Merge backend changes into `main` to trigger Render's native deployment. Monitor the commit and deployment result in the service's Events page. Use Render's Manual Deploy option when a redeployment is needed without a new commit.

The former `Deploy Omnix Backend / deploy` GitHub Actions workflow deployed over SSH to AWS EC2 and has been removed. Backend deployments no longer require the `EC2_HOST`, `EC2_USER`, or `EC2_SSH_KEY` GitHub secrets. Historical AWS workflow failures remain attached to older commits; removing the workflow stops new AWS runs.

`render.yaml` contains the version-controlled configuration for Blueprint provisioning. The existing service was configured directly in Render; edits to `render.yaml` do not automatically change its dashboard settings unless it is managed by a Blueprint. Keep the service settings aligned when changing build or start commands.

Keep application secrets in Render's Environment settings. Frontend deployments continue through Vercel.
